"""A7's "Others" path, and the default platform seed.

Lives in `core` rather than in `features/purchase_platforms/service.py` for
hard rule 4 — slices never import each other — because this is needed by
TWO of them: `tickets.service.create_ticket` (a vendor's free-text "Others"
name has to resolve to a real, company-scoped row) and
`companies.service.create_company` (a brand-new company starts with the
real platforms every vendor already knows). The admin-gated CRUD in
`features/purchase_platforms/` does not need either function — it only
ever lists, renames and retires rows a human already created.

`tickets.service._resolve_purchase_platform` already duplicates the small
read-by-id query that lives on `features/purchase_platforms/service._load`
rather than importing it, for the same reason: a cross-slice import here
would be the one exception the rest of the codebase doesn't have.
"""

import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.purchase_platform import MAX_PLATFORM_NAME, PurchasePlatform

#: The real storefronts every company starts with — seeded twice from this
#: one list: for a brand-new company, in `create_company`'s own transaction
#: (`seed_default_platforms` below); and for every company that already
#: existed when A7's "Others" path shipped, in that change's migration.
#:
#: The migration SPELLS THIS LIST OUT again rather than importing it —
#: `alembic/versions/*.py` never imports `app.*` (hard rule 6's "the
#: migration restates the same rule in SQL") — so change both together if
#: the list ever changes.
DEFAULT_PURCHASE_PLATFORMS: tuple[str, ...] = (
    "Amazon",
    "Flipkart",
    "Reliance Digital",
    "Croma",
    "Tata CLiQ",
    "Vijay Sales",
    "JioMart",
    "Myntra",
    "Meesho",
    "Snapdeal",
    "Ajio",
    "Nykaa",
)


async def seed_default_platforms(
    db: AsyncSession, company_id: uuid.UUID, *, created_by: uuid.UUID | None
) -> None:
    """Give a brand-new company the real platforms every vendor already
    knows, so the ONLINE dropdown is never empty on day one.

    Called from `create_company`'s own transaction, beside the rules row,
    the free credits and the home franchisee — a company that exists without
    them is one whose first "online" ticket has nothing to offer but
    "Others". No dedupe needed here: the company has no platform rows yet,
    so unlike `find_or_create` below this never has to ask.
    """
    db.add_all(
        [
            PurchasePlatform(company_id=company_id, name=name, created_by=created_by)
            for name in DEFAULT_PURCHASE_PLATFORMS
        ]
    )
    # autoflush is off (hard rule 10). The caller (`create_company`) commits;
    # this only has to make the rows visible to anything read before then.
    await db.flush()


def match_existing(
    existing: Sequence[tuple[uuid.UUID, str, bool]], name: str
) -> tuple[uuid.UUID, bool] | None:
    """Which of a company's own platforms `name` refers to, case-insensitively.

    PUBLIC and pure — `core.carve_out.plan_carve_out`'s split applied here —
    so the dedupe/reactivate DECISION is unit-testable without a database;
    the query that gathers `existing` (in `find_or_create` below) is a plain
    WHERE clause, never a decision itself. `existing` is
    `(id, name, is_active)` for every one of the company's own non-deleted
    platforms. Returns `(id, needs_reactivate)` for the first row whose name
    matches once both sides are trimmed and case-folded, or `None` when
    nothing does.
    """
    target = name.strip().lower()
    for row_id, row_name, is_active in existing:
        if row_name.strip().lower() == target:
            return row_id, not is_active
    return None


async def find_or_create(
    db: AsyncSession,
    company_id: uuid.UUID,
    name: str,
    *,
    created_by: uuid.UUID | None = None,
) -> PurchasePlatform:
    """A7's "Others" case: a vendor types a platform name at intake, and
    typing it has to both resolve to a real row AND join the dropdown for
    the next vendor who raises a ticket.

    Case-insensitive on `lower(name)`, among the COMPANY'S OWN non-deleted
    rows — the same rule `purchase_platforms.service._assert_name_free`
    enforces for the admin screen, applied here to a vendor's free text
    instead of a deliberate add. A RETIRED platform typed again is
    REACTIVATED rather than duplicated: its name is already taken by the
    hand-written partial unique index
    (`uq_purchase_platforms_company_name_lower`), so inserting a second row
    under it would 409 on the very call meant to recover from one.

    Callable by a VENDOR principal — this runs inside
    `tickets.service.create_ticket`, never behind the admin-gated CRUD in
    `features/purchase_platforms/router.py` — and scoped strictly to
    `company_id`, never anything wider: a vendor must not be able to spell a
    new platform into another company's list.

    Flushes but never commits — the caller (`create_ticket`) owns the
    transaction, and a refused ticket (an unknown model, an SLA clash, the
    credit gate) must not leave a platform row behind with nothing pointing
    at it.
    """
    trimmed = name.strip()[:MAX_PLATFORM_NAME]

    existing = (
        await db.execute(
            select(
                PurchasePlatform.id,
                PurchasePlatform.name,
                PurchasePlatform.is_active,
            ).where(
                PurchasePlatform.company_id == company_id,
                PurchasePlatform.deleted_at.is_(None),
            )
        )
    ).all()
    matched = match_existing(existing, trimmed)
    if matched is not None:
        platform_id, needs_reactivate = matched
        row = await db.get(PurchasePlatform, platform_id)
        assert row is not None  # read above, inside this same session
        if needs_reactivate:
            row.is_active = True
            row.updated_by = created_by
        return row

    row = PurchasePlatform(company_id=company_id, name=trimmed, created_by=created_by)
    db.add(row)
    # autoflush is off (hard rule 10) and the caller needs `row.id` at once,
    # to stamp the ticket it is resolving a platform for.
    await db.flush()
    return row
