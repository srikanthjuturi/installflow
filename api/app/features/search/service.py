"""Global search — one term, five entities, the caller's own slice of each.

Two questions this module answers, and they use the SAME statement builders so
they can never disagree about what a term matches or who may see it:

    preview      the top few of every type the caller may see
    one type     a page of one type, for the panel's infinite scroll

**It is not a new door.** Every builder applies exactly the predicates the
entity's own list endpoint applies — company, soft delete, territory, feature —
so a row this returns is a row the caller could already have reached by paging
its list screen. A row outside their scope is simply absent, which is the search
equivalent of hard rule 1's *404, not 403*.

Vendors and technicians never get here: `require_staff_principal` refuses them at
the route. That is what lets this module stay short — a vendor's rule is
ownership rather than geography, and each slice states its own version of it, so
a cross-entity read for a vendor would have to re-derive all five.
"""

from collections.abc import Callable, Sequence
from typing import Any

from sqlalchemy import Row, Select, String, func, literal, or_, select, union_all
from sqlalchemy import false as sql_false
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Principal
from app.core.features import effective_features
from app.core.schemas import ListParams
from app.core.scope import own_scope, visible_pincodes
from app.core.visibility import technician_scope
from app.db.repository import territory_scope
from app.features.search.schemas import (
    SearchGroup,
    SearchHit,
    SearchPreviewOut,
    SearchType,
)
from app.models.membership import Membership
from app.models.product import ProductCategory, ProductModel, ProductSubcategory
from app.models.role import (
    NATIONAL_HEAD,
    ROLE_LABELS,
    ROLE_RANKS,
    TECHNICIAN,
    VENDOR_ROLES,
)
from app.models.technician import TechnicianProfile
from app.models.ticket import Ticket
from app.models.user import User
from app.models.vendor import Vendor

#: Below this, a term matches most of the database and none of it usefully. The
#: console does not even send the request; this is the server saying the same
#: thing, because the console is not the only caller.
MIN_TERM = 2

#: Rows per group in the preview. Enough to recognise the one you meant, few
#: enough that every type stays visible above the fold.
PREVIEW_LIMIT = 5

#: How far a count is allowed to run. Every match here is a sequential scan with
#: a per-row `lower()` (there is no trigram index in this schema), so an exact
#: total on a common term is the expensive half of the request and nobody reads
#: the difference between 4,000 and 5,000. Past this the console renders `99+`,
#: which is a bounded count rather than an invented number.
COUNT_CAP = 100


def _term(search: str | None) -> str | None:
    """The LIKE pattern, or None when there is nothing worth asking."""
    cleaned = (search or "").strip().lower()
    if len(cleaned) < MIN_TERM:
        return None
    return f"%{cleaned}%"


def _text(value: str | None) -> str | None:
    """Blank subtitles are absent subtitles — the row should close up, not gap."""
    cleaned = (value or "").strip()
    return cleaned or None


def _join(*parts: str | None) -> str | None:
    return _text(" · ".join(p for p in parts if (p or "").strip()))


# ── per-entity statements ─────────────────────────────────────────────────────
#
# Each returns a Select of display columns in a fixed order, ending in a
# DETERMINISTIC order_by whose last term is the primary key. That last part is
# load-bearing: page 2 of an infinite scroll is a fresh query, and any two rows
# tying on the sort column would be free to swap between pages — which reads to
# the user as a row repeating and another one vanishing.


async def _tickets_stmt(
    db: AsyncSession, principal: Principal, term: str
) -> Select:
    stmt = select(
        Ticket.id,
        Ticket.code,
        Ticket.customer_name,
        Ticket.pincode,
        Ticket.status,
    ).where(
        Ticket.company_id == principal.company_id,
        Ticket.deleted_at.is_(None),
        or_(
            func.lower(Ticket.code).like(term),
            func.lower(Ticket.customer_name).like(term),
            func.lower(Ticket.customer_phone).like(term),
            Ticket.pincode.like(term),
            func.lower(Ticket.serial_number).like(term),
        ),
    )

    # The same rule `tickets.scoped()` applies for staff. Not that function,
    # because slices never import each other — and its other half, the vendor
    # branch, is unreachable here anyway.
    pincodes = await visible_pincodes(db, principal)
    if isinstance(pincodes, list):
        # Covers nothing, so sees nothing. `sql_false()`, not `func.false()`:
        # the latter renders `false()`, which Postgres rejects.
        stmt = stmt.where(sql_false())
    elif pincodes is not None:
        stmt = stmt.where(Ticket.pincode.in_(pincodes))

    return stmt.order_by(Ticket.created_at.desc(), Ticket.id)


def _ticket_hit(row: Row) -> SearchHit:
    return SearchHit(
        id=str(row.id),
        type=SearchType.ticket,
        title=row.code,
        subtitle=_join(row.customer_name, row.pincode),
        badge=_text(row.status),
    )


async def _technicians_stmt(
    db: AsyncSession, principal: Principal, term: str
) -> Select:
    stmt = (
        select(
            TechnicianProfile.id,
            User.full_name,
            User.phone,
            TechnicianProfile.code,
            TechnicianProfile.status,
        )
        .join(Membership, Membership.id == TechnicianProfile.membership_id)
        .join(User, User.id == Membership.user_id)
        .where(
            TechnicianProfile.company_id == principal.company_id,
            Membership.deleted_at.is_(None),
            or_(
                func.lower(User.full_name).like(term),
                func.lower(User.phone).like(term),
                func.lower(TechnicianProfile.code).like(term),
            ),
        )
    )

    own_id, own = await own_scope(
        db, user_id=principal.user_id, company_id=principal.company_id
    )
    stmt = technician_scope(stmt, principal, own_id, own)

    # Open invites are deliberately not searched. An invite is a phone number
    # and nothing else — there is no record to land on, and the technician list
    # is where a manager chases one.
    return stmt.order_by(User.full_name.asc(), TechnicianProfile.id)


def _technician_hit(row: Row) -> SearchHit:
    return SearchHit(
        id=str(row.id),
        type=SearchType.technician,
        title=row.full_name,
        subtitle=_join(row.phone, row.code),
        badge=_text((row.status or "").capitalize()),
    )


async def _users_stmt(db: AsyncSession, principal: Principal, term: str) -> Select:
    stmt = (
        select(Membership.id, User.full_name, User.email, User.role)
        .join(User, User.id == Membership.user_id)
        .where(
            Membership.company_id == principal.company_id,
            Membership.deleted_at.is_(None),
            # Users, Technicians and Vendors are disjoint screens, and the
            # groups here mirror them — a technician found under "Users" would
            # link to a screen that does not list them.
            User.role.not_in([TECHNICIAN, *VENDOR_ROLES]),
            or_(
                func.lower(User.full_name).like(term),
                func.lower(User.email).like(term),
            ),
        )
    )

    own_id, own = await own_scope(
        db, user_id=principal.user_id, company_id=principal.company_id
    )
    stmt = territory_scope(
        stmt, role=principal.role, own_membership_id=own_id, own_scope=own
    )
    return stmt.order_by(User.full_name.asc(), Membership.id)


def _user_hit(row: Row) -> SearchHit:
    return SearchHit(
        id=str(row.id),
        type=SearchType.user,
        title=row.full_name,
        subtitle=_text(row.email),
        badge=_text(ROLE_LABELS.get(row.role, row.role)),
    )


def _vendors_stmt(principal: Principal, term: str) -> Select:
    return (
        select(Vendor.id, Vendor.name, Vendor.city, Vendor.is_active)
        .where(
            Vendor.company_id == principal.company_id,
            Vendor.deleted_at.is_(None),
            or_(
                func.lower(Vendor.name).like(term),
                func.lower(Vendor.gst_number).like(term),
                func.lower(Vendor.contact_person).like(term),
                func.lower(Vendor.phone).like(term),
                func.lower(Vendor.city).like(term),
            ),
        )
        .order_by(Vendor.name.asc(), Vendor.id)
    )


def _vendor_hit(row: Row) -> SearchHit:
    return SearchHit(
        id=str(row.id),
        type=SearchType.vendor,
        title=row.name,
        subtitle=_text(row.city),
        badge=None if row.is_active else "Paused",
    )


#: What a product hit calls itself. The three levels share one group because
#: they share one screen — every one of them lands on `/categories`.
_PRODUCT_LEVELS = {
    "category": "Category",
    "subcategory": "Subcategory",
    "model": "Model",
}


def _products_stmt(principal: Principal, term: str) -> Select:
    """All three levels of the master as one group.

    `parent` is the level above — the context that tells two identically named
    models apart. Empty rather than NULL so the three legs of the union agree on
    a type without a cast; `_text` turns it back into an absent subtitle.
    """
    company = principal.company_id

    categories = select(
        literal("category").label("level"),
        ProductCategory.id.label("row_id"),
        ProductCategory.name.label("name"),
        literal("", String).label("parent"),
    ).where(
        ProductCategory.company_id == company,
        ProductCategory.deleted_at.is_(None),
        func.lower(ProductCategory.name).like(term),
    )

    subcategories = (
        select(
            literal("subcategory").label("level"),
            ProductSubcategory.id.label("row_id"),
            ProductSubcategory.name.label("name"),
            ProductCategory.name.label("parent"),
        )
        .join(
            ProductCategory,
            ProductCategory.id == ProductSubcategory.category_id,
        )
        .where(
            ProductSubcategory.company_id == company,
            ProductSubcategory.deleted_at.is_(None),
            func.lower(ProductSubcategory.name).like(term),
        )
    )

    models = (
        select(
            literal("model").label("level"),
            ProductModel.id.label("row_id"),
            ProductModel.name.label("name"),
            ProductSubcategory.name.label("parent"),
        )
        .join(
            ProductSubcategory,
            ProductSubcategory.id == ProductModel.subcategory_id,
        )
        .where(
            ProductModel.company_id == company,
            ProductModel.deleted_at.is_(None),
            func.lower(ProductModel.name).like(term),
        )
    )

    union = union_all(categories, subcategories, models).subquery()
    return select(
        union.c.level, union.c.row_id, union.c.name, union.c.parent
    ).order_by(union.c.name.asc(), union.c.row_id)


def _product_hit(row: Row) -> SearchHit:
    return SearchHit(
        id=str(row.row_id),
        type=SearchType.product,
        title=row.name,
        subtitle=_text(row.parent),
        badge=_PRODUCT_LEVELS.get(row.level, row.level),
    )


# ── source resolution ─────────────────────────────────────────────────────────

#: The order the panel lists them in. Tickets first because that is what an ops
#: user is holding a number for.
SEARCH_ORDER: tuple[SearchType, ...] = (
    SearchType.ticket,
    SearchType.technician,
    SearchType.user,
    SearchType.vendor,
    SearchType.product,
)

_FEATURE_FOR: dict[SearchType, str] = {
    SearchType.ticket: "jobs.view",
    SearchType.technician: "technicians.view",
    SearchType.user: "users.view",
    SearchType.vendor: "vendors.view",
    SearchType.product: "masters.view",
}


def _may_see(kind: SearchType, principal: Principal, features: set[str]) -> bool:
    if _FEATURE_FOR[kind] not in features:
        return False
    if kind is SearchType.vendor:
        # Mirrors `GET /vendors`, which carries a rank floor no per-company
        # feature override can lift. Without this an Area Manager would reach
        # vendor rows through search that the vendors screen refuses him —
        # a privilege escalation through a new door.
        return principal.rank <= ROLE_RANKS[NATIONAL_HEAD]
    return True


async def _source(
    db: AsyncSession, principal: Principal, kind: SearchType, term: str
) -> tuple[Select, Callable[[Row], SearchHit]]:
    """The statement and its row mapper. Callers check `_may_see` first."""
    if kind is SearchType.ticket:
        return await _tickets_stmt(db, principal, term), _ticket_hit
    if kind is SearchType.technician:
        return await _technicians_stmt(db, principal, term), _technician_hit
    if kind is SearchType.user:
        return await _users_stmt(db, principal, term), _user_hit
    if kind is SearchType.vendor:
        return _vendors_stmt(principal, term), _vendor_hit
    return _products_stmt(principal, term), _product_hit


async def _count(db: AsyncSession, stmt: Select) -> tuple[int, bool]:
    """How many matches, counted no further than `COUNT_CAP`.

    The LIMIT lives inside the counted subquery, so Postgres stops scanning once
    it has enough rows to answer instead of counting the whole table.
    """
    total = await db.scalar(
        select(func.count()).select_from(
            stmt.order_by(None).limit(COUNT_CAP).subquery()
        )
    )
    total = int(total or 0)
    return total, total >= COUNT_CAP


async def _rows(
    db: AsyncSession, stmt: Select, *, limit: int, offset: int
) -> Sequence[Any]:
    return (await db.execute(stmt.limit(limit).offset(offset))).all()


# ── the two reads ─────────────────────────────────────────────────────────────


async def preview(
    db: AsyncSession, principal: Principal, search: str | None
) -> SearchPreviewOut:
    """The top `PREVIEW_LIMIT` of every type the caller may see.

    Empty groups are dropped rather than returned empty: the console turns this
    list straight into its scope pills, so a group with nothing in it would be a
    pill that leads to a blank panel.
    """
    term = _term(search)
    if term is None:
        return SearchPreviewOut(groups=[])

    features = await effective_features(
        db, role=principal.role, company_id=principal.company_id
    )

    groups: list[SearchGroup] = []
    for kind in SEARCH_ORDER:
        if not _may_see(kind, principal, features):
            continue
        stmt, to_hit = await _source(db, principal, kind, term)
        total, capped = await _count(db, stmt)
        if total == 0:
            continue
        rows = await _rows(db, stmt, limit=PREVIEW_LIMIT, offset=0)
        groups.append(
            SearchGroup(
                type=kind,
                total=total,
                capped=capped,
                items=[to_hit(r) for r in rows],
            )
        )

    return SearchPreviewOut(groups=groups)


async def search_one(
    db: AsyncSession,
    principal: Principal,
    kind: SearchType,
    params: ListParams,
) -> tuple[list[SearchHit], int]:
    """A page of one type, for the panel's infinite scroll.

    A type the caller may not see answers with an EMPTY PAGE, not a 403 — the
    same answer the preview gives by omitting the group. A 403 here would
    confirm that the type exists and that somebody else can read it, and the
    console has no screen on which to say so.
    """
    term = _term(params.search)
    if term is None:
        return [], 0

    features = await effective_features(
        db, role=principal.role, company_id=principal.company_id
    )
    if not _may_see(kind, principal, features):
        return [], 0

    stmt, to_hit = await _source(db, principal, kind, term)
    total, _capped = await _count(db, stmt)
    if total == 0:
        return [], 0

    rows = await _rows(db, stmt, limit=params.limit, offset=params.offset)
    return [to_hit(r) for r in rows], total
