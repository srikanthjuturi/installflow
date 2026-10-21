"""Franchisee management — CRUD, pincodes (the carve-out) and admin logins.

Company-scoped end to end: every query filters the caller's company, and a
guessed id from another one returns 404, never 403 — a 403 confirms the row
exists. One transaction per write; the email (and only the email) goes out
after commit. Writes to WHO OWNS A PINCODE hold the exclusive side of
`core.franchise.lock_routing`, so a ticket being stamped meanwhile reads the
old map, but only below a committed carve-out — Task 04's readers take the
shared side.

This slice builds its own `TicketEvent` rows (`franchisee_changed`) because
slices never import each other (api hard rule 4) — the same thing
`jobs/service._event` does, for the same reason.
"""

import re
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.carve_out import (
    clash_lines,
    clash_summary,
    diff_codes,
    find_clashes,
    plan_carve_out,
    ticket_moves,
)
from app.core.company_code import derive, unique_code
from app.core.deps import Principal
from app.core.errors import AppError
from app.core.franchise import home_franchisee_id, lock_routing
from app.core.franchise_logins import (
    FRANCHISEE_ADMIN,
    CreatedLogin,
    active_admin_count,
    blocks_last_admin,
    create_login,
    last_active,
    login_base,
    mail_password,
    reissue_password,
    set_active,
)
from app.core.notifications import notify
from app.core.pincode_ranges import (
    PincodeRangeError,
    compress,
    empty_ranges,
    expand,
    format_range,
    parse,
    span,
)
from app.core.realtime import (
    publish_notification,
    publish_pool_changed,
    publish_technician_changed,
    publish_ticket_changed,
)
from app.core.schemas import ListParams, canonical_filter
from app.core.tickets import TERMINAL_STATUSES
from app.models.franchisee import Franchisee, FranchiseePincode, HOME_CODE, MAX_CODE
from app.models.membership import Membership
from app.models.redemption import Redemption
from app.models.role import FRANCHISE_ROLES
from app.models.technician import (
    LIVE_INVITE_STATUSES,
    TechnicianInvite,
    TechnicianInvitePincode,
    TechnicianPincode,
    TechnicianProfile,
)
from app.models.ticket import Ticket
from app.models.ticket_event import TicketEvent
from app.models.territory import Pincode
from app.models.user import User

from app.features.franchisees.schemas import (
    FranchiseeAdminCreatedOut,
    FranchiseeAdminOut,
    FranchiseeCreatedOut,
    FranchiseeOptionOut,
    FranchiseeOut,
    InviteChangeOut,
    MovedTechnicianOut,
    PincodeChangeOut,
    PincodeClashOut,
    RangeSetOut,
    RestampedTicketOut,
    RestampedTicketsOut,
    TrimmedTechnicianOut,
)

#: F6's "open and unassigned": a ticket no technician has accepted keeps
#: waiting in the queue for whoever covers the pincode now, and Escalated sits
#: in the same queue for a manager. Reported to the index owner (03 §4.5).
OPEN_TICKET_STATUSES = ("New", "Slot Pending", "Escalated")


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND, detail="Franchisee not found"
    )


def _admin_not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND, detail="Admin not found"
    )


async def _load(
    db: AsyncSession, company_id: uuid.UUID, franchisee_id: uuid.UUID
) -> Franchisee:
    """The franchisee, company-filtered. Inactive rows load — 404 is for a row
    that does not exist in this company, not for a switched-off one."""
    row = await db.scalar(
        select(Franchisee).where(
            Franchisee.id == franchisee_id,
            Franchisee.company_id == company_id,
            Franchisee.deleted_at.is_(None),
        )
    )
    if row is None:
        raise _not_found()
    return row


# ── lists and hydration ────────────────────────────────────────────────────


async def list_franchisees(
    db: AsyncSession,
    principal: Principal,
    params: ListParams,
    *,
    kind: str | None,
    status_filter: str | None,
) -> tuple[list[FranchiseeOut], int]:
    company_id = principal.company_id
    stmt = select(Franchisee).where(
        Franchisee.company_id == company_id, Franchisee.deleted_at.is_(None)
    )
    wanted_kind = canonical_filter(kind, ("internal", "external"))
    if wanted_kind is False:  # a stale bookmark — empty page, never a 422
        return [], 0
    if wanted_kind:
        stmt = stmt.where(Franchisee.kind == wanted_kind)
    wanted_status = canonical_filter(status_filter, ("active", "inactive"))
    if wanted_status is False:
        return [], 0
    if wanted_status == "active":
        stmt = stmt.where(Franchisee.is_active.is_(True))
    elif wanted_status == "inactive":
        stmt = stmt.where(Franchisee.is_active.is_(False))
    if params.search:
        term = f"%{params.search.lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(Franchisee.name).like(term),
                func.lower(Franchisee.code).like(term),
            )
        )
    sort_col = {
        "name": func.lower(Franchisee.name),
        "code": Franchisee.code,
        "createdAt": Franchisee.created_at,
    }.get(params.sortBy or "name", func.lower(Franchisee.name))
    # Home first, then the sort column, then id — a stable, total order.
    stmt = stmt.order_by(
        Franchisee.is_home.desc(),
        sort_col.desc() if params.sortDir == "desc" else sort_col.asc(),
        Franchisee.id,
    )
    total = (
        await db.scalar(
            select(func.count()).select_from(stmt.order_by(None).subquery())
        )
        or 0
    )
    rows = (
        (await db.execute(stmt.offset(params.offset).limit(params.limit)))
        .scalars()
        .all()
    )
    return await _hydrate(db, company_id, list(rows)), total


async def list_options(
    db: AsyncSession, principal: Principal
) -> list[FranchiseeOptionOut]:
    """Every franchisee, home first then name — active AND inactive. The
    screens that pick a franchisee for history need the switched-off ones too."""
    company_id = principal.company_id
    rows = (
        (
            await db.execute(
                select(Franchisee)
                .where(
                    Franchisee.company_id == company_id,
                    Franchisee.deleted_at.is_(None),
                )
                .order_by(
                    Franchisee.is_home.desc(), func.lower(Franchisee.name), Franchisee.id
                )
            )
        )
        .scalars()
        .all()
    )
    return [
        FranchiseeOptionOut(
            id=r.id,
            name=r.name,
            code=r.code,
            kind=r.kind,
            isHome=r.is_home,
            isActive=r.is_active,
        )
        for r in rows
    ]


async def get_franchisee(
    db: AsyncSession, principal: Principal, franchisee_id: uuid.UUID
) -> FranchiseeOut:
    row = await _load(db, principal.company_id, franchisee_id)
    return (await _hydrate(db, principal.company_id, [row]))[0]


async def _hydrate(
    db: AsyncSession, company_id: uuid.UUID, rows: list[Franchisee]
) -> list[FranchiseeOut]:
    """Five batched reads for a whole page — the way `users.list_users`
    hydrates, and no N+1 hiding behind a small limit."""
    if not rows:
        return []
    ids = [r.id for r in rows]
    non_home = [r.id for r in rows if not r.is_home]

    tech_counts = dict(
        (
            await db.execute(
                select(TechnicianProfile.franchisee_id, func.count())
                .join(Membership, Membership.id == TechnicianProfile.membership_id)
                .where(
                    TechnicianProfile.company_id == company_id,
                    Membership.deleted_at.is_(None),
                    TechnicianProfile.franchisee_id.in_(ids),
                )
                .group_by(TechnicianProfile.franchisee_id)
            )
        ).all()
    )
    invite_counts = dict(
        (
            await db.execute(
                select(TechnicianInvite.franchisee_id, func.count())
                .where(
                    TechnicianInvite.company_id == company_id,
                    TechnicianInvite.status.in_(LIVE_INVITE_STATUSES),
                    TechnicianInvite.franchisee_id.in_(ids),
                )
                .group_by(TechnicianInvite.franchisee_id)
            )
        ).all()
    )
    admin_counts = dict(
        (
            await db.execute(
                select(Membership.franchisee_id, func.count())
                .join(User, User.id == Membership.user_id)
                .where(
                    Membership.company_id == company_id,
                    Membership.deleted_at.is_(None),
                    Membership.is_active.is_(True),
                    User.deleted_at.is_(None),
                    User.role == FRANCHISEE_ADMIN,
                    Membership.franchisee_id.in_(ids),
                )
                .group_by(Membership.franchisee_id)
            )
        ).all()
    )
    owned: dict[uuid.UUID, set[str]] = defaultdict(set)
    if non_home:
        for fid, code in await db.execute(
            select(FranchiseePincode.franchisee_id, FranchiseePincode.pincode).where(
                FranchiseePincode.company_id == company_id,
                FranchiseePincode.franchisee_id.in_(non_home),
            )
        ):
            owned[fid].add(code)
    home_count = 0
    if any(r.is_home for r in rows):
        home_count = (
            await db.scalar(
                select(func.count())
                .select_from(Pincode)
                .where(
                    Pincode.is_active.is_(True),
                    Pincode.code.not_in(
                        select(FranchiseePincode.pincode).where(
                            FranchiseePincode.company_id == company_id
                        )
                    ),
                )
            )
            or 0
        )
    # Loaded ONCE per request, and only when the page holds a non-home row.
    universe = await _active_universe(db) if non_home else []

    out = []
    for r in rows:
        codes = owned.get(r.id, set())
        out.append(
            FranchiseeOut(
                id=r.id,
                code=r.code,
                name=r.name,
                kind=r.kind,
                isHome=r.is_home,
                contactName=r.contact_name,
                contactPhone=r.contact_phone,
                contactEmail=r.contact_email,
                isActive=r.is_active,
                pincodeRanges="" if r.is_home else compress(codes, universe=universe),
                pincodeCount=home_count if r.is_home else len(codes),
                technicianCount=tech_counts.get(r.id, 0),
                openInviteCount=invite_counts.get(r.id, 0),
                adminCount=admin_counts.get(r.id, 0),
                createdAt=r.created_at,
            )
        )
    return out


async def _active_universe(db: AsyncSession) -> list[str]:
    """The company's ACTIVE master codes, sorted, loaded once per request."""
    rows = await db.execute(select(Pincode.code).where(Pincode.is_active.is_(True)))
    return sorted(code for (code,) in rows.all())


async def _owners(db: AsyncSession, company_id: uuid.UUID) -> dict[str, uuid.UUID]:
    """Every owned pincode of the company → its franchisee. The home holds no
    rows here (F4) — it is everyone else's catch-all, never a diff participant."""
    rows = await db.execute(
        select(FranchiseePincode.pincode, FranchiseePincode.franchisee_id).where(
            FranchiseePincode.company_id == company_id
        )
    )
    return dict(rows.all())


async def _names(
    db: AsyncSession, company_id: uuid.UUID, ids: set[uuid.UUID]
) -> dict[uuid.UUID, str]:
    """Franchisee ids → names, for the from/to labels in previews and refusals.
    No `deleted_at` filter: a ticket can carry a removed franchisee's id, and a
    preview must not render a hole where the history was."""
    if not ids:
        return {}
    rows = await db.execute(
        select(Franchisee.id, Franchisee.name).where(
            Franchisee.company_id == company_id, Franchisee.id.in_(ids)
        )
    )
    return {fid: name for fid, name in rows.all()}


async def _clash_error(
    db: AsyncSession, company_id: uuid.UUID, clashes: dict[str, uuid.UUID]
) -> AppError:
    """The 409 for an apply that collides with an owner: prose naming the owner,
    one `code — owner` line per pincode in `errors` for the console."""
    names = await _names(db, company_id, set(clashes.values()))
    named = {
        code: names.get(oid, "another franchisee")
        for code, oid in sorted(clashes.items())
    }
    return AppError(
        409,
        "FRANCHISEE_PINCODE_TAKEN",
        f"Already owned by another franchisee: {clash_summary(named)}."
        " Remove them, or take them off that franchisee first.",
        errors=clash_lines(named),
    )


# ── create / edit ──────────────────────────────────────────────────────────


async def _assert_name_free(
    db: AsyncSession,
    company_id: uuid.UUID,
    name: str,
    *,
    exclude_id: uuid.UUID | None = None,
) -> None:
    stmt = select(Franchisee.id).where(
        Franchisee.company_id == company_id,
        Franchisee.deleted_at.is_(None),
        func.lower(Franchisee.name) == name.lower(),
    )
    if exclude_id is not None:
        stmt = stmt.where(Franchisee.id != exclude_id)
    if await db.scalar(stmt) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A franchisee called {name} already exists",
        )


def _resolve_code(body, taken: set[str]) -> str:
    """An explicit code validated, or else derived from the name and
    uniquified. HOME is the home franchisee's code in every company — always
    refused as an explicit value, and never produced by the derived path
    because it is passed in `taken`."""
    if body.code is None:
        try:
            return unique_code(
                derive(body.name.strip()), taken | {HOME_CODE}, max_len=MAX_CODE
            )
        except ValueError as err:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(err)
            ) from err
    cleaned = re.sub(r"[^A-Za-z0-9]", "", body.code).upper()
    if cleaned == HOME_CODE:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="HOME is reserved for the home franchisee — choose another code.",
        )
    if len(cleaned) < 2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Franchisee code needs at least 2 letters or digits",
        )
    if len(cleaned) > MAX_CODE:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Franchisee code is at most {MAX_CODE} letters or digits",
        )
    if not cleaned[0].isalpha():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Franchisee code must start with a letter",
        )
    if cleaned in {t.upper() for t in taken}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That code is already used by another franchisee",
        )
    return cleaned


async def create_franchisee(
    db: AsyncSession, principal: Principal, body
) -> FranchiseeCreatedOut:
    company_id = principal.company_id
    name = body.name.strip()
    await _assert_name_free(db, company_id, name)
    taken = set(
        (
            await db.execute(
                select(Franchisee.code).where(
                    Franchisee.company_id == company_id,
                    Franchisee.deleted_at.is_(None),
                )
            )
        ).scalars()
    )
    code = _resolve_code(body, taken)
    row = Franchisee(
        company_id=company_id,
        name=name,
        code=code,
        kind=body.kind,
        is_home=False,
        contact_name=body.contactName,
        contact_phone=body.contactPhone,
        contact_email=str(body.contactEmail) if body.contactEmail else None,
        is_active=True,
        created_by=principal.user_id,
    )
    db.add(row)
    await db.flush()  # the id (hard rule 10) — the admin login hangs off it
    # Task 10: stamp franchisee_travel_rules for both technician types (TRAVEL_DEFAULTS).

    login: CreatedLogin | None = None
    if body.admin is not None:
        # Every identity refusal happens HERE, before commit, so a refused
        # email leaves no franchisee row behind.
        login = await create_login(
            db,
            company_id=company_id,
            franchisee_id=row.id,
            role=FRANCHISEE_ADMIN,
            full_name=body.admin.fullName.strip(),
            email=str(body.admin.email),
            phone=body.admin.phone,
            actor_id=principal.user_id,
        )
    # One transaction: franchisee (+ travel rules, Task 10) + admin login.
    await db.commit()

    # Email AFTER commit: a failed email must not roll back an account that
    # exists — that is what the `failed` status and the response copy exist for.
    email_status, email_error = "skipped", None
    if login is not None:
        email_status, email_error = await mail_password(
            db,
            company_id=company_id,
            user=login.user,
            temporary_password=login.temporary_password,
        )

    out = (await _hydrate(db, company_id, [row]))[0]
    admin = None
    if login is not None:
        n = await active_admin_count(db, company_id=company_id, franchisee_id=row.id)
        admin = _admin_created_out(
            login.membership,
            login.user,
            is_home=False,
            count=n,
            email_status=email_status,
            email_error=email_error,
            temporary_password=None
            if email_status == "sent"
            else login.temporary_password,
        )
    return FranchiseeCreatedOut(**out.model_dump(), admin=admin)


async def update_franchisee(
    db: AsyncSession, principal: Principal, franchisee_id: uuid.UUID, body
) -> FranchiseeOut:
    company_id = principal.company_id
    row = await _load(db, company_id, franchisee_id)
    if body.kind == "external" and row.is_home:
        raise AppError(
            409,
            "FRANCHISEE_HOME_IMMUTABLE",
            "The home franchisee is always internal.",
        )
    changed = body.model_fields_set
    if "name" in changed and body.name is not None:
        name = body.name.strip()
        await _assert_name_free(db, company_id, name, exclude_id=row.id)
        row.name = name
    if "kind" in changed and body.kind is not None:
        # Renaming kind of the home to internal is harmless; external is
        # refused above (F1).
        row.kind = body.kind
    if "contactName" in changed and body.contactName is not None:
        row.contact_name = body.contactName
    if "contactPhone" in changed:  # explicit null clears it
        row.contact_phone = body.contactPhone
    if "contactEmail" in changed:  # explicit null clears it
        row.contact_email = str(body.contactEmail) if body.contactEmail else None
    row.updated_by = principal.user_id
    await db.commit()
    return (await _hydrate(db, company_id, [row]))[0]


# ── pincodes: the carve-out ────────────────────────────────────────────────


@dataclass
class _Candidate:
    """One technician or live invite the plan moves or trims."""

    id: uuid.UUID
    label: str  # the technician's code, or the invite's phone
    name: str | None
    from_id: uuid.UUID
    coverage_count: int  # full coverage BEFORE the change


@dataclass
class _Plan:
    """What one save will write, keyed on the TARGET franchisee: the add pass
    targets `this` franchisee, the remove pass targets the home."""

    moved: dict[uuid.UUID, list[_Candidate]] = field(default_factory=dict)
    trimmed: dict[uuid.UUID, list[tuple[_Candidate, list[str]]]] = field(default_factory=dict)
    invite_moves: dict[uuid.UUID, list[_Candidate]] = field(default_factory=dict)
    invite_trims: dict[uuid.UUID, list[tuple[_Candidate, list[str]]]] = field(default_factory=dict)
    #: (ticket_id, from_id, to_id) — only the ones whose owner changes
    moves: list[tuple[uuid.UUID, uuid.UUID, uuid.UUID]] = field(default_factory=list)
    #: ticket id → (code, pincode, from_id) for every re-stamp candidate
    ticket_stubs: dict[uuid.UUID, tuple[str, str, uuid.UUID]] = field(default_factory=dict)
    assigned_kept: int = 0
    added: frozenset[str] = frozenset()
    removed: frozenset[str] = frozenset()
    #: the set this save writes (and which the ranges render back from)
    stored: frozenset[str] = frozenset()
    names: dict[uuid.UUID, str] = field(default_factory=dict)

    @property
    def pass_targets(self) -> list[uuid.UUID]:
        """Add pass first, then the remove pass — the order the previews list."""
        order: list[uuid.UUID] = []
        for target in (self.this_id, self.home_id):
            if target is not None and target not in order:
                order.append(target)
        return order

    this_id: uuid.UUID | None = None
    home_id: uuid.UUID | None = None


async def set_pincodes(
    db: AsyncSession,
    principal: Principal,
    franchisee_id: uuid.UUID,
    body,
    *,
    dry_run: bool,
) -> PincodeChangeOut:
    company_id = principal.company_id
    row = await _load(db, company_id, franchisee_id)
    if row.is_home:
        raise AppError(
            409,
            "FRANCHISEE_HOME_IMMUTABLE",
            f"{row.name} is the home franchisee. It owns every pincode no other"
            " franchisee owns, so it has no ranges to edit.",
        )
    if not row.is_active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Activate {row.name} before giving it pincodes.",
        )
    try:
        ranges = parse(body.pincodeRanges)
    except PincodeRangeError as err:
        # Bad grammar is a 422 naming the token (Task 08 §4.1); `.tokens`
        # echo it and `str(err)` is the whole error.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(err)
        ) from err
    universe = await _active_universe(db)
    wanted = frozenset(expand(ranges, universe))

    # A dry run takes NO lock — previews must never queue behind saves. Apply
    # locks EXCLUSIVELY before reading owners: every decision below (owners,
    # plan) is made under it, and the writes land without a gap a rival save
    # could fit into.
    if not dry_run:
        await lock_routing(db, company_id, exclusive=True)

    owners = await _owners(db, company_id)
    current = {c for c, f in owners.items() if f == row.id}
    clashes = find_clashes(wanted, owners, row.id)
    if clashes and not dry_run:
        raise await _clash_error(db, company_id, clashes)
    if clashes and dry_run:
        # The preview plans over wanted − clashing codes, so the console can
        # show what the REST would do; `added` excludes them too.
        wanted = frozenset(wanted - set(clashes))

    added, removed = diff_codes(current, wanted)
    home_id = await home_franchisee_id(db, company_id)
    plan = await _plan(
        db, company_id, this=row.id, home_id=home_id, added=added, removed=removed
    )
    plan.this_id = row.id
    plan.home_id = home_id
    plan.added = frozenset(added)
    plan.removed = frozenset(removed)
    plan.stored = (frozenset(current) | plan.added) - plan.removed

    owner_names = (
        await _names(db, company_id, set(clashes.values())) if clashes else {}
    )
    named_clashes = {
        code: (oid, owner_names.get(oid, "another franchisee"))
        for code, oid in sorted(clashes.items())
    }
    out = _change_out(
        row=row,
        plan=plan,
        ranges=ranges,
        universe=universe,
        resolved=len(wanted),
        dry_run=dry_run,
        clashes=named_clashes if dry_run else {},
    )
    if dry_run:
        # Ends the read transaction — a preview owns nothing.
        await db.rollback()
        return out
    if not added and not removed:
        return out
    row.updated_by = principal.user_id
    await _apply(db, principal, plan, this=row.id, home_id=home_id)
    await db.commit()
    return out


def _change_out(
    *,
    row,
    plan: _Plan,
    ranges,
    universe,
    resolved: int,
    dry_run: bool,
    clashes: dict[str, tuple[uuid.UUID, str]],
) -> PincodeChangeOut:
    names = plan.names
    moved_out: list[MovedTechnicianOut] = []
    trimmed_out: list[TrimmedTechnicianOut] = []
    for target in plan.pass_targets:
        for cand in plan.moved.get(target, []):
            moved_out.append(
                MovedTechnicianOut(
                    id=cand.id,
                    code=cand.label,
                    name=cand.name,
                    fromFranchiseeId=cand.from_id,
                    fromFranchiseeName=names.get(cand.from_id, "—"),
                    toFranchiseeId=target,
                    toFranchiseeName=names.get(target, "—"),
                    pincodeCount=cand.coverage_count,
                )
            )
        for cand, losing in plan.trimmed.get(target, []):
            trimmed_out.append(
                TrimmedTechnicianOut(
                    id=cand.id,
                    code=cand.label,
                    name=cand.name,
                    fromFranchiseeId=cand.from_id,
                    fromFranchiseeName=names.get(cand.from_id, "—"),
                    losing=losing,
                    keepingCount=cand.coverage_count - len(losing),
                )
            )
    invites_out: list[InviteChangeOut] = []
    for target in plan.pass_targets:
        for cand in plan.invite_moves.get(target, []):
            invites_out.append(
                InviteChangeOut(id=cand.id, phone=cand.label, change="moved", losing=[])
            )
        for cand, losing in plan.invite_trims.get(target, []):
            invites_out.append(
                InviteChangeOut(
                    id=cand.id, phone=cand.label, change="trimmed", losing=losing
                )
            )

    sample_rows = sorted(
        (
            (tid, stub)
            for tid, stub in plan.ticket_stubs.items()
        ),
        key=lambda item: item[1][0],  # by ticket code, at most 20
    )[:20]
    restamped_sample = [
        RestampedTicketOut(
            id=tid,
            code=stub[0],
            pincode=stub[1],
            fromFranchiseeName=names.get(stub[2], "—"),
        )
        for tid, stub in sample_rows
    ]
    return PincodeChangeOut(
        dryRun=dry_run,
        franchiseeId=row.id,
        pincodeRanges=compress(plan.stored, universe=universe),
        resolvedCount=resolved,
        unknownCount=span(ranges) - resolved,
        emptyRanges=[format_range(r) for r in empty_ranges(ranges, universe)],
        added=RangeSetOut(
            count=len(plan.added), ranges=compress(plan.added, universe=universe)
        ),
        removed=RangeSetOut(
            count=len(plan.removed), ranges=compress(plan.removed, universe=universe)
        ),
        clashes=[
            PincodeClashOut(
                pincode=code, franchiseeId=cid, franchiseeName=name
            )
            for code, (cid, name) in sorted(clashes.items())
        ]
        if dry_run
        else [],
        clashCount=len(clashes),
        movedTechnicians=moved_out,
        trimmedTechnicians=trimmed_out,
        invitesChanged=invites_out,
        restampedTickets=RestampedTicketsOut(count=len(plan.moves), sample=restamped_sample),
        assignedTicketsKept=plan.assigned_kept,
    )


async def _plan(
    db: AsyncSession,
    company_id: uuid.UUID,
    *,
    this: uuid.UUID,
    home_id: uuid.UUID,
    added: frozenset[str],
    removed: frozenset[str],
) -> _Plan:
    """Reads only. Two passes — codes going to `this` (added), codes going
    back to the home (removed) — over technicians, live invites and tickets.
    Invites follow the technicians' rules though F6 names only technicians
    (03 §4.5): an invite left behind would make Task 04's registration check
    refuse the person at the moment they finally register."""
    plan = _Plan()
    passes = [
        (this, this, added, False),  # (target, exclude_id, codes, straddle_at_this)
        (home_id, this, removed, True),
    ]
    for target, other, codes, straddle in passes:
        if not codes:
            continue
        # Technician candidates: NOT already under the target, covering ≥ 1 code.
        candidate_stmt = (
            select(TechnicianProfile.id)
            .join(Membership, Membership.id == TechnicianProfile.membership_id)
            .join(
                TechnicianPincode,
                (TechnicianPincode.technician_id == TechnicianProfile.id)
                & (TechnicianPincode.company_id == TechnicianProfile.company_id),
            )
            .where(
                TechnicianProfile.company_id == company_id,
                Membership.deleted_at.is_(None),
                TechnicianPincode.pincode.in_(codes),
            )
        )
        if straddle:
            candidate_stmt = candidate_stmt.where(TechnicianProfile.franchisee_id == other)
        else:
            candidate_stmt = candidate_stmt.where(TechnicianProfile.franchisee_id != other)
        tech_ids = list((await db.execute(candidate_stmt.distinct())).scalars())
        if tech_ids:
            rows = (
                await db.execute(
                    select(
                        TechnicianProfile.id,
                        TechnicianProfile.code,
                        TechnicianProfile.franchisee_id,
                        User.full_name,
                    )
                    .join(Membership, Membership.id == TechnicianProfile.membership_id)
                    .join(User, User.id == Membership.user_id)
                    .where(
                        TechnicianProfile.company_id == company_id,
                        TechnicianProfile.id.in_(tech_ids),
                    )
                )
            ).all()
            meta = {
                r.id: _Candidate(
                    id=r.id,
                    label=r.code,
                    name=r.full_name,
                    from_id=r.franchisee_id,
                    coverage_count=0,
                )
                for r in rows
            }
            coverage = await _tech_coverage(db, company_id, tech_ids)
            carve = plan_carve_out(codes, coverage)
            moved_list: list[_Candidate] = []
            trimmed_list: list[tuple[_Candidate, list[str]]] = []
            for tid in carve.moved:
                cand = meta[tid]
                cand.coverage_count = len(coverage[tid])
                moved_list.append(cand)
            for tid, losing in carve.trimmed.items():
                cand = meta[tid]
                cand.coverage_count = len(coverage[tid])
                trimmed_list.append((cand, sorted(losing)))
            if moved_list:
                plan.moved[target] = moved_list
            if trimmed_list:
                plan.trimmed[target] = trimmed_list

        # Live invites, the same two queries — no membership to join.
        invite_stmt = (
            select(TechnicianInvite.id)
            .join(
                TechnicianInvitePincode,
                (TechnicianInvitePincode.invite_id == TechnicianInvite.id)
                & (TechnicianInvitePincode.company_id == TechnicianInvite.company_id),
            )
            .where(
                TechnicianInvite.company_id == company_id,
                TechnicianInvite.status.in_(LIVE_INVITE_STATUSES),
                TechnicianInvitePincode.pincode.in_(codes),
            )
        )
        if straddle:
            invite_stmt = invite_stmt.where(TechnicianInvite.franchisee_id == other)
        else:
            invite_stmt = invite_stmt.where(TechnicianInvite.franchisee_id != other)
        invite_ids = [
            r.id for r in (await db.execute(invite_stmt.distinct())).scalars()
        ]
        if invite_ids:
            rows = (
                await db.execute(
                    select(TechnicianInvite.id, TechnicianInvite.phone, TechnicianInvite.franchisee_id).where(
                        TechnicianInvite.company_id == company_id,
                        TechnicianInvite.id.in_(invite_ids),
                    )
                )
            ).all()
            meta = {
                r.id: _Candidate(
                    id=r.id,
                    label=r.phone,
                    name=None,
                    from_id=r.franchisee_id,
                    coverage_count=0,
                )
                for r in rows
            }
            coverage = await _invite_coverage(db, company_id, invite_ids)
            carve = plan_carve_out(codes, coverage)
            moved_list, trimmed_list = [], []
            for iid in carve.moved:
                cand = meta[iid]
                cand.coverage_count = len(coverage[iid])
                moved_list.append(cand)
            for iid, losing in carve.trimmed.items():
                cand = meta[iid]
                cand.coverage_count = len(coverage[iid])
                trimmed_list.append((cand, sorted(losing)))
            if moved_list:
                plan.invite_moves[target] = moved_list
            if trimmed_list:
                plan.invite_trims[target] = trimmed_list

    all_codes = set(added) | set(removed)
    if all_codes:
        rows = (
            await db.execute(
                select(Ticket.id, Ticket.code, Ticket.pincode, Ticket.franchisee_id).where(
                    Ticket.company_id == company_id,
                    Ticket.deleted_at.is_(None),
                    Ticket.technician_id.is_(None),
                    Ticket.status.in_(OPEN_TICKET_STATUSES),
                    Ticket.pincode.in_(all_codes),
                )
            )
        ).all()
        owner_after = {c: this for c in added} | {c: home_id for c in removed}
        plan.ticket_stubs = {r.id: (r.code, r.pincode, r.franchisee_id) for r in rows}
        plan.moves = ticket_moves(
            [(r.id, r.pincode, r.franchisee_id) for r in rows], owner_after
        )
        plan.assigned_kept = (
            await db.scalar(
                select(func.count())
                .select_from(Ticket)
                .where(
                    Ticket.company_id == company_id,
                    Ticket.deleted_at.is_(None),
                    Ticket.technician_id.is_not(None),
                    Ticket.status.not_in(TERMINAL_STATUSES),
                    Ticket.pincode.in_(all_codes),
                )
            )
            or 0
        )

    name_ids: set[uuid.UUID] = {this, home_id} | {fid for _, fid, _ in plan.moves}
    for cands in plan.moved.values():
        name_ids.update(cand.from_id for cand in cands)
    for pairs in plan.trimmed.values():
        name_ids.update(cand.from_id for cand, _losing in pairs)
    for cands in plan.invite_moves.values():
        name_ids.update(cand.from_id for cand in cands)
    for pairs in plan.invite_trims.values():
        name_ids.update(cand.from_id for cand, _losing in pairs)
    plan.names = await _names(db, company_id, name_ids)
    return plan


async def _tech_coverage(
    db: AsyncSession, company_id: uuid.UUID, tech_ids: list[uuid.UUID]
) -> dict[uuid.UUID, set[str]]:
    rows = await db.execute(
        select(TechnicianPincode.technician_id, TechnicianPincode.pincode).where(
            TechnicianPincode.company_id == company_id,
            TechnicianPincode.technician_id.in_(tech_ids),
        )
    )
    out: dict[uuid.UUID, set[str]] = defaultdict(set)
    for tid, code in rows.all():
        out[tid].add(code)
    return out


async def _invite_coverage(
    db: AsyncSession, company_id: uuid.UUID, invite_ids: list[uuid.UUID]
) -> dict[uuid.UUID, set[str]]:
    rows = await db.execute(
        select(TechnicianInvitePincode.invite_id, TechnicianInvitePincode.pincode).where(
            TechnicianInvitePincode.company_id == company_id,
            TechnicianInvitePincode.invite_id.in_(invite_ids),
        )
    )
    out: dict[uuid.UUID, set[str]] = defaultdict(set)
    for iid, code in rows.all():
        out[iid].add(code)
    return out


async def _apply(
    db: AsyncSession,
    principal: Principal,
    plan: _Plan,
    *,
    this: uuid.UUID,
    home_id: uuid.UUID,
) -> list[Any]:
    """The writes, in this order, in the caller's transaction. Returns the
    `franchisee_changed` events for the caller's tests to assert on."""
    company_id = principal.company_id
    actor = principal.user_id

    # 1. Rows leaving this franchisee go away (the honest record of a code
    #    handed back is the row going away — the model has no soft delete).
    if plan.removed:
        await db.execute(
            delete(FranchiseePincode).where(
                FranchiseePincode.company_id == company_id,
                FranchiseePincode.franchisee_id == this,
                FranchiseePincode.pincode.in_(plan.removed),
            )
        )

    # 2. Rows gained. The UNIQUE is the boundary; the pre-check under the lock
    #    makes the race narrow enough that one IntegrityError retry is plenty.
    if plan.added:
        stmt = pg_insert(FranchiseePincode).values(
            [
                {
                    "company_id": company_id,
                    "franchisee_id": this,
                    "pincode": code,
                    "created_by": actor,
                }
                for code in sorted(plan.added)
            ]
        )
        try:
            await db.execute(stmt)
        except IntegrityError:
            await db.rollback()
            owners = await _owners(db, company_id)
            clashes = find_clashes(plan.added, owners, this)
            if clashes:
                raise await _clash_error(db, company_id, clashes)
            raise AppError(
                409,
                "FRANCHISEE_PINCODE_TAKEN",
                "Another change to these pincodes was saved at the same moment."
                " Reload and try again.",
            )

    # 3–4. Moved technicians (one UPDATE per target) then trimmed ones (lose
    # exactly the inside codes; the rest is non-empty by construction).
    for target, cands in plan.moved.items():
        if not cands:
            continue
        await db.execute(
            update(TechnicianProfile)
            .where(
                TechnicianProfile.company_id == company_id,
                TechnicianProfile.id.in_([c.id for c in cands]),
            )
            .values(franchisee_id=target, updated_by=actor)
        )
    for _target, pairs in plan.trimmed.items():
        for cand, losing in pairs:
            await db.execute(
                delete(TechnicianPincode).where(
                    TechnicianPincode.company_id == company_id,
                    TechnicianPincode.technician_id == cand.id,
                    TechnicianPincode.pincode.in_(losing),
                )
            )

    # 5. The same for live invites.
    for target, cands in plan.invite_moves.items():
        if not cands:
            continue
        await db.execute(
            update(TechnicianInvite)
            .where(
                TechnicianInvite.company_id == company_id,
                TechnicianInvite.id.in_([c.id for c in cands]),
            )
            .values(franchisee_id=target)
        )
    for _target, pairs in plan.invite_trims.items():
        for cand, losing in pairs:
            await db.execute(
                delete(TechnicianInvitePincode).where(
                    TechnicianInvitePincode.company_id == company_id,
                    TechnicianInvitePincode.invite_id == cand.id,
                    TechnicianInvitePincode.pincode.in_(losing),
                )
            )

    # 6. Tickets, one guarded UPDATE per target. Only RETURNED rows get events
    #    and frames — a ticket accepted between the read and this write keeps
    #    its franchisee, which is exactly F6's "assigned keep theirs".
    moves_by_target: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    froms_by_target: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
    for _tid, _fid, to_fid in plan.moves:
        moves_by_target[to_fid].append(_tid)
        froms_by_target[to_fid].add(_fid)
    returned: list[Any] = []
    for target, ids in moves_by_target.items():
        if not ids:
            continue
        rows = (
            await db.execute(
                update(Ticket)
                .where(
                    Ticket.company_id == company_id,
                    Ticket.id.in_(ids),
                    # Structural pin beside the company filter: only a ticket
                    # still stamped a losing franchisee is re-stamped, so the
                    # write is scoped even if the id list were ever built wrong.
                    Ticket.franchisee_id.in_(froms_by_target[target]),
                    Ticket.deleted_at.is_(None),
                    Ticket.technician_id.is_(None),
                    Ticket.status.in_(OPEN_TICKET_STATUSES),
                )
                .values(franchisee_id=target)
                .returning(
                    Ticket.id,
                    Ticket.code,
                    Ticket.pincode,
                    Ticket.node_path_ids,
                    Ticket.company_id,
                    Ticket.vendor_id,
                    Ticket.created_by,
                    # The NEW stamp, RETURNed so the ticket frame below (and the
                    # console socket it feeds) carries who the ticket belongs to
                    # NOW — the old franchisee's portal learns on its next
                    # refetch.
                    Ticket.franchisee_id,
                )
            )
        ).all()
        returned.extend(rows)

    # 7. One event per returned ticket, same transaction.
    from_of: dict[uuid.UUID, uuid.UUID] = {tid: fid for tid, fid, _ in plan.moves}
    to_of: dict[uuid.UUID, uuid.UUID] = {
        tid: to_fid for to_fid, ids in moves_by_target.items() for tid in ids
    }
    events = [
        TicketEvent(
            company_id=r.company_id,
            ticket_id=r.id,
            kind="franchisee_changed",
            actor_kind="staff",
            actor_label=principal.user.full_name or "—",
            note=(
                f"{plan.names.get(from_of[r.id], '—')} →"
                f" {plan.names.get(to_of[r.id], '—')}"
                f" · pincode {r.pincode} reassigned"
            ),
            from_status=None,
            to_status=None,
            created_by=actor,
        )
        for r in returned
    ]
    if events:
        db.add_all(events)

    # 8. One bell per pass that moved or trimmed anybody (≤ 2 per save).
    for target in plan.pass_targets:
        m = len(plan.moved.get(target, []))
        t = len(plan.trimmed.get(target, []))
        if not m and not t:
            continue
        k = len(moves_by_target.get(target, []))
        title = f"Pincodes reassigned to {plan.names.get(target, '—')}"
        detail = (
            f"{m} technician(s) moved · {t} lost pincodes"
            f" · {k} open ticket(s) re-routed"
        )
        raised = await notify(
            db,
            company_id=company_id,
            kind="technician_moved",
            title=title,
            detail=detail,
            to=f"/franchisees/{target}",
            pincode=None,
        )
        await publish_notification(
            db, company_id=company_id, pincode=None, notification_id=raised.id
        )

        # Task 03 hook (05 §4.8): the franchisee portals hear the same story —
        # one row per affected NON-home franchisee of this pass, addressed to
        # its OWN admins with step 8's title and detail and published with the
        # same addressing. Targets and sources alike: a franchisee whose
        # technicians were handed over or trimmed is told as plainly as one
        # that received them (08's confirm copy promises they are told).
        # Home is skipped — step 8's row is already company-wide and reaches
        # its staff, and it must never reach a franchisee reader either.
        affected: set[uuid.UUID] = {
            c.from_id for c in plan.moved.get(target, [])
        } | {c.from_id for c, _losing in plan.trimmed.get(target, [])}
        affected.add(target)
        for fid in sorted(affected - {home_id}):
            ring = await notify(
                db,
                company_id=company_id,
                kind="technician_moved",
                title=title,
                detail=detail,
                to="/technicians",
                pincode=None,
                audience="franchisee_admin",
                franchisee_id=fid,
            )
            await publish_notification(
                db,
                company_id=company_id,
                pincode=None,
                notification_id=ring.id,
                audience="franchisee_admin",
                franchisee_id=fid,
            )

    # 9. Realtime frames, inside the transaction (they fire on commit).
    moved_ids = [c.id for lst in plan.moved.values() for c in lst]
    for cand_list in plan.trimmed.values():
        moved_ids.extend(c[0].id for c in cand_list)
    for tid in moved_ids[:50]:
        await publish_technician_changed(db, company_id=company_id, technician_id=tid)
    # One pool frame per distinct (pincode, path, franchisee) — and per
    # re-stamped ticket TWO of the latter: a frame for the OLD franchisee, whose
    # technicians were being offered the ticket a second ago and must now stop
    # ringing for it, and one for the NEW one, whose technicians must start.
    # Only the new one when the stamp did not actually change (the ticket
    # returned to its own pool).
    pools: set[tuple[str, tuple[uuid.UUID, ...], uuid.UUID]] = set()
    for r in returned:
        path = tuple(r.node_path_ids or [])
        new = to_of.get(r.id, r.franchisee_id)
        pools.add((r.pincode, path, new))
        old = from_of.get(r.id)
        if old is not None and old != new:
            pools.add((r.pincode, path, old))
    for pincode, node_path_ids, franchisee_id in pools:
        await publish_pool_changed(
            db,
            company_id=company_id,
            pincode=pincode,
            node_path_ids=list(node_path_ids),
            franchisee_id=franchisee_id,
        )
    for r in returned[:25]:
        await publish_ticket_changed(db, r)
    return returned


# ── deactivate / activate ──────────────────────────────────────────────────


async def deactivate(db: AsyncSession, principal: Principal, franchisee_id: uuid.UUID) -> FranchiseeOut:
    company_id = principal.company_id
    row = await _load(db, company_id, franchisee_id)
    if row.is_home:
        raise AppError(
            409,
            "FRANCHISEE_HOME_IMMUTABLE",
            f"{row.name} cannot be deactivated.",
        )
    if not row.is_active:
        # Idempotent by shape, like every other switch-off.
        return (await _hydrate(db, company_id, [row]))[0]

    n_tech = (
        await db.scalar(
            select(func.count())
            .select_from(TechnicianProfile)
            .join(Membership, Membership.id == TechnicianProfile.membership_id)
            .where(
                TechnicianProfile.company_id == company_id,
                TechnicianProfile.franchisee_id == row.id,
                Membership.deleted_at.is_(None),
            )
        )
        or 0
    )
    n_invites = (
        await db.scalar(
            select(func.count())
            .select_from(TechnicianInvite)
            .where(
                TechnicianInvite.company_id == company_id,
                TechnicianInvite.franchisee_id == row.id,
                TechnicianInvite.status.in_(LIVE_INVITE_STATUSES),
            )
        )
        or 0
    )
    if n_tech or n_invites:
        home_id = await home_franchisee_id(db, company_id)
        names = await _names(db, company_id, {home_id})
        home_name = names.get(home_id, "the home")
        held = []
        if n_tech:
            held.append(f"{n_tech} technician(s)")
        if n_invites:
            held.append(f"{n_invites} pending invite(s)")
        raise AppError(
            409,
            "FRANCHISEE_HAS_TECHNICIANS",
            f"{row.name} still has {' and '.join(held)}. Clear its pincodes to"
            f" hand them back to {home_name}, then deactivate it.",
        )

    n_redemptions = (
        await db.scalar(
            select(func.count())
            .select_from(Redemption)
            .where(
                Redemption.company_id == company_id,
                Redemption.franchisee_id == row.id,
                Redemption.confirmed_at.is_(None),
                Redemption.declined_at.is_(None),
            )
        )
        or 0
    )
    if n_redemptions:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{row.name} has {n_redemptions} redemption(s) still waiting to be paid or confirmed. Settle them first.",
        )

    # Technicians and invites are zero, so the release re-stamps tickets only
    # — the ordinary `set_pincodes` path with wanted = ∅ (steps 4–6 of §4.5).
    await lock_routing(db, company_id, exclusive=True)
    owners = await _owners(db, company_id)
    current = {c for c, f in owners.items() if f == row.id}
    home_id = await home_franchisee_id(db, company_id)
    plan = await _plan(
        db,
        company_id,
        this=row.id,
        home_id=home_id,
        added=frozenset(),
        removed=frozenset(current),
    )
    plan.this_id = row.id
    plan.home_id = home_id
    plan.added = frozenset()
    plan.removed = frozenset(current)
    plan.stored = frozenset()
    row.updated_by = principal.user_id
    await _apply(db, principal, plan, this=row.id, home_id=home_id)

    row.is_active = False
    row.updated_by = principal.user_id
    # Every franchise-role login of this franchisee loses access now — the
    # memberships toggle, never the users (they may hold roles elsewhere).
    logins = (await db.execute(login_base(company_id, row.id, FRANCHISE_ROLES))).all()
    for membership, user in logins:
        await set_active(
            db,
            membership=membership,
            user=user,
            active=False,
            actor_id=principal.user_id,
        )
    await db.commit()
    return (await _hydrate(db, company_id, [row]))[0]


async def activate(db: AsyncSession, principal: Principal, franchisee_id: uuid.UUID) -> FranchiseeOut:
    company_id = principal.company_id
    row = await _load(db, company_id, franchisee_id)
    row.is_active = True
    row.updated_by = principal.user_id
    # Does NOT re-enable admins (route 12, one each) or restore pincodes —
    # they were handed back to the home, and a restore would steal them.
    await db.commit()
    return (await _hydrate(db, company_id, [row]))[0]


# ── admin logins (routes 9–13) ─────────────────────────────────────────────


def _admin_out(
    membership: Membership,
    user: User,
    *,
    is_home: bool,
    count: int,
    last_login: dict | None = None,
) -> FranchiseeAdminOut:
    """One admin row. `count` is the franchisee's active-admin count INCLUDING
    this one — the input `blocks_last_admin` expects."""
    is_active = membership.is_active and user.is_active
    return FranchiseeAdminOut(
        membershipId=membership.id,
        userId=user.id,
        fullName=user.full_name,
        email=user.email,
        phone=user.phone,
        isActive=is_active,
        lastLoginAt=(last_login or {}).get(user.id),
        createdAt=membership.created_at,
        isLastActiveAdmin=blocks_last_admin(
            is_home=is_home, target_is_active=is_active, active_admin_count=count
        ),
    )


def _admin_created_out(
    membership: Membership,
    user: User,
    *,
    is_home: bool,
    count: int,
    email_status: str,
    email_error: str | None,
    temporary_password: str | None,
) -> FranchiseeAdminCreatedOut:
    base = _admin_out(membership, user, is_home=is_home, count=count)
    return FranchiseeAdminCreatedOut(
        **base.model_dump(),
        emailStatus=email_status,
        emailError=email_error,
        temporaryPassword=temporary_password,
    )


async def _admin_pair(
    db: AsyncSession,
    company_id: uuid.UUID,
    franchisee_id: uuid.UUID,
    membership_id: uuid.UUID,
) -> tuple[Membership, User]:
    """The membership through `login_base`'s scoping — a membership of another
    franchisee in the same company is 404 here, never 403."""
    row = (
        await db.execute(
            login_base(company_id, franchisee_id, [FRANCHISEE_ADMIN]).where(
                Membership.id == membership_id
            )
        )
    ).first()
    if row is None:
        raise _admin_not_found()
    membership, user = row
    return membership, user


async def list_admins(
    db: AsyncSession, principal: Principal, franchisee_id: uuid.UUID
) -> list[FranchiseeAdminOut]:
    company_id = principal.company_id
    row = await _load(db, company_id, franchisee_id)
    pairs = (
        await db.execute(
            login_base(company_id, franchisee_id, [FRANCHISEE_ADMIN]).order_by(
                Membership.is_active.desc(), func.lower(User.full_name), Membership.id
            )
        )
    ).all()
    if not pairs:
        return []
    logins = await last_active(db, [user.id for _m, user in pairs])
    count = await active_admin_count(db, company_id=company_id, franchisee_id=row.id)
    return [
        _admin_out(
            membership, user, is_home=row.is_home, count=count, last_login=logins
        )
        for membership, user in pairs
    ]


async def add_admin(
    db: AsyncSession, principal: Principal, franchisee_id: uuid.UUID, body
) -> FranchiseeAdminCreatedOut:
    company_id = principal.company_id
    row = await _load(db, company_id, franchisee_id)
    if not row.is_active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Activate {row.name} first.",
        )
    login = await create_login(
        db,
        company_id=company_id,
        franchisee_id=row.id,
        role=FRANCHISEE_ADMIN,
        full_name=body.fullName.strip(),
        email=str(body.email),
        phone=body.phone,
        actor_id=principal.user_id,
    )
    count = await active_admin_count(db, company_id=company_id, franchisee_id=row.id)
    await db.commit()
    email_status, email_error = await mail_password(
        db,
        company_id=company_id,
        user=login.user,
        temporary_password=login.temporary_password,
    )
    return _admin_created_out(
        login.membership,
        login.user,
        is_home=row.is_home,
        count=count,
        email_status=email_status,
        email_error=email_error,
        temporary_password=None if email_status == "sent" else login.temporary_password,
    )


async def set_admin_active(
    db: AsyncSession,
    principal: Principal,
    franchisee_id: uuid.UUID,
    membership_id: uuid.UUID,
    *,
    active: bool,
) -> FranchiseeAdminOut:
    company_id = principal.company_id
    row = await _load(db, company_id, franchisee_id)
    membership, user = await _admin_pair(
        db, company_id, franchisee_id, membership_id
    )
    if active is False and not row.is_home:
        # R3, serialised ON the franchisee row: two admins deactivated by two
        # people at once would otherwise each see the other still active and
        # both pass. The row lock, taken before the count, settles it.
        await db.execute(
            select(Franchisee.id)
            .where(
                Franchisee.company_id == company_id, Franchisee.id == row.id
            )
            .with_for_update()
        )
        count = await active_admin_count(db, company_id=company_id, franchisee_id=row.id)
        if blocks_last_admin(
            is_home=row.is_home,
            target_is_active=membership.is_active and user.is_active,
            active_admin_count=count,
        ):
            raise AppError(
                409,
                "FRANCHISEE_LAST_ADMIN",
                f"{user.full_name or user.email} is {row.name}'s only active"
                " admin. Add another admin first — without one, nobody can"
                " approve its technicians' UPI changes or pay their"
                " redemptions.",
            )
    await set_active(
        db,
        membership=membership,
        user=user,
        active=active,
        actor_id=principal.user_id,
    )
    await db.flush()  # the toggle is visible to the count below
    count = await active_admin_count(db, company_id=company_id, franchisee_id=row.id)
    logins = await last_active(db, [user.id])
    out = _admin_out(
        membership, user, is_home=row.is_home, count=count, last_login=logins
    )
    await db.commit()
    return out


async def reissue_admin_password(
    db: AsyncSession,
    principal: Principal,
    franchisee_id: uuid.UUID,
    membership_id: uuid.UUID,
) -> FranchiseeAdminCreatedOut:
    company_id = principal.company_id
    row = await _load(db, company_id, franchisee_id)
    membership, user = await _admin_pair(
        db, company_id, franchisee_id, membership_id
    )
    password = await reissue_password(db, user=user, actor_id=principal.user_id)
    await db.commit()
    email_status, email_error = await mail_password(
        db,
        company_id=company_id,
        user=user,
        temporary_password=password,
    )
    count = await active_admin_count(db, company_id=company_id, franchisee_id=row.id)
    return _admin_created_out(
        membership,
        user,
        is_home=row.is_home,
        count=count,
        email_status=email_status,
        email_error=email_error,
        temporary_password=None if email_status == "sent" else password,
    )