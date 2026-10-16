"""Which franchisee owns what — the one place that answers it.

Core, not a slice, because companies, technicians, onboarding, tickets and
redemptions all need this — api hard rule 4 (slices never import each other).
The two pure functions import only `app.models.*`, so they are unit-testable
with no database.
"""

import uuid
from collections.abc import Iterable, Mapping

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company import Company
from app.models.franchisee import HOME_CODE, KIND_INTERNAL, MAX_NAME, Franchisee, FranchiseePincode
from app.models.territory import Pincode


def home_franchisee_fields(company_name: str) -> dict:
    """PURE. The column values of a company's home franchisee — the migration's INSERT says the same."""
    return {
        "name": company_name[:MAX_NAME],
        "code": HOME_CODE,
        "kind": KIND_INTERNAL,
        "is_home": True,
        "is_active": True,
    }


def route_pincodes(
    pincodes: Iterable[str], owned: Mapping[str, uuid.UUID], home_id: uuid.UUID
) -> dict[str, uuid.UUID]:
    """PURE. Each pincode's franchisee: its owner row, else the home (F4)."""
    return {p: owned.get(p, home_id) for p in set(pincodes)}


async def create_home_franchisee(db: AsyncSession, company: Company) -> Franchisee:
    """Write the company's home. Flushes, never commits — the caller owns the transaction, exactly as
    `rules.load_rules` and `credits.grant_free` do inside `create_company`."""
    row = Franchisee(
        company_id=company.id, created_by=company.created_by, **home_franchisee_fields(company.name)
    )
    db.add(row)
    await db.flush()
    return row


async def home_franchisee_id(db: AsyncSession, company_id: uuid.UUID) -> uuid.UUID:
    """The company's home. Self-heals like `rules.load_rules`: a company created by the OLD code between
    the production migration and the publish has none (see the migration's own docstring), and its first
    ticket must not 500 for that. Concurrent repairs collide on uq_franchisees_one_home -> errors.py 409,
    and the retry finds the row."""
    found = await db.scalar(
        select(Franchisee.id).where(
            Franchisee.company_id == company_id,
            Franchisee.is_home.is_(True),
            Franchisee.deleted_at.is_(None),
        )
    )
    if found is not None:
        return found
    company = await db.scalar(select(Company).where(Company.id == company_id))
    if company is None:
        raise LookupError(f"company {company_id} does not exist")
    return (await create_home_franchisee(db, company)).id


async def franchisee_for_pincode(db: AsyncSession, company_id: uuid.UUID, pincode: str) -> uuid.UUID:
    """The owner of this pincode in this company, else the home. One indexed probe
    (uq_franchisee_pincodes_company_pincode) plus, on a miss, the home lookup."""
    owner = await db.scalar(
        select(FranchiseePincode.franchisee_id)
        .join(
            Franchisee,
            (Franchisee.company_id == FranchiseePincode.company_id)
            & (Franchisee.id == FranchiseePincode.franchisee_id),
        )
        .where(
            FranchiseePincode.company_id == company_id,
            FranchiseePincode.pincode == pincode,
            Franchisee.deleted_at.is_(None),
        )
    )
    return owner if owner is not None else await home_franchisee_id(db, company_id)


async def franchisees_for_pincodes(
    db: AsyncSession, company_id: uuid.UUID, pincodes: Iterable[str]
) -> dict[str, uuid.UUID]:
    """`franchisee_for_pincode` for a whole sheet in TWO queries, for the bulk importer (which exists to
    avoid per-row queries)."""
    wanted = set(pincodes)
    if not wanted:
        return {}
    rows = await db.execute(
        select(FranchiseePincode.pincode, FranchiseePincode.franchisee_id)
        .join(
            Franchisee,
            (Franchisee.company_id == FranchiseePincode.company_id)
            & (Franchisee.id == FranchiseePincode.franchisee_id),
        )
        .where(
            FranchiseePincode.company_id == company_id,
            FranchiseePincode.pincode.in_(wanted),
            Franchisee.deleted_at.is_(None),
        )
    )
    return route_pincodes(wanted, dict(rows.all()), await home_franchisee_id(db, company_id))


def franchisee_pincodes_subquery(
    company_id: uuid.UUID, franchisee_id: uuid.UUID, *, is_home: bool
) -> Select:
    """SQL, never a list: the codes a franchisee owns.

    Non-home: its own rows. Home: every ACTIVE master code that no franchisee in this company owns (F4) —
    thousands of codes, which is why this is a subquery for Postgres to filter with, never materialised
    (the `core.scope.pincodes_in_states` rule). `NOT IN` is safe: `franchisee_pincodes.pincode` is NOT
    NULL, so the NULL trap cannot fire.

    For PICKING and RANGE checks (Tasks 03, 04, 14). Ticket and technician VISIBILITY go by the stamped
    `franchisee_id` column, never by this (Task 02) — after a carve-out an assigned ticket keeps its
    franchisee while its pincode now belongs to another.
    """
    if not is_home:
        return select(FranchiseePincode.pincode).where(
            FranchiseePincode.company_id == company_id, FranchiseePincode.franchisee_id == franchisee_id
        )
    claimed = select(FranchiseePincode.pincode).where(FranchiseePincode.company_id == company_id)
    return select(Pincode.code).where(Pincode.is_active.is_(True), Pincode.code.not_in(claimed))
