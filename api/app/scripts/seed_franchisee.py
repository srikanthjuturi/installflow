"""Seed franchisee test data: three non-home franchisees with real pincodes.

    python -m app.scripts.seed_franchisee          # seed on dev DB
    python -m app.scripts.seed_franchisee --reset  # drop existing test franchisees first
    python -m app.scripts.seed_franchisee --dry    # preview what set_pincodes would do

Works against the Seed Appliances LOADTEST company.  If you need to seed
against a different company, pass --company-id <uuid>.

Franchisees created:
  NORTH  (110001-110099  — Delhi south/central)
  SOUTH  (500001-500099  — Hyderabad central)
  EAST   (560001-560099  — Bangalore central)
  HOME   catches every other pincode (implicit, no rows in franchisee_pincodes)
"""

import argparse
import asyncio
import sys
import uuid

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy import delete, select  # noqa: E402

from app.core.database import AsyncSessionLocal  # noqa: E402
from app.core.deps import Principal  # noqa: E402
from app.core.franchise import home_franchisee_id  # noqa: E402
from app.features.franchisees import service as franchisees_service  # noqa: E402
from app.features.franchisees.schemas import (  # noqa: E402
    FranchiseeCreateRequest,
    PincodesRequest,
)
from app.models.franchisee import Franchisee, FranchiseePincode  # noqa: E402
from app.models.role import ADMIN, ROLE_RANKS  # noqa: E402
from app.models.user import User  # noqa: E402

# The three test franchisees we seed — name, code, pincodeRanges.
FRANCHISEES = [
    ("North Zone Test", "NORTH", "110001-110099"),
    ("South Zone Test", "SOUTH", "500001-500099"),
    ("East Zone Test", "EAST", "560001-560099"),
]

SEED_COMPANY_NAME_LIKE = "Seed Appliances%"


async def _admin_principal(db, company_id: uuid.UUID) -> Principal:
    """Load the first active admin user for the company as a Principal."""
    from app.models.company import Company
    from app.models.membership import Membership

    row = await db.execute(
        select(User, Company)
        .join(Membership, Membership.user_id == User.id)
        .join(Company, Company.id == Membership.company_id)
        .where(
            Company.id == company_id,
            User.role == ADMIN,
            User.is_active.is_(True),
            Membership.is_active.is_(True),
        )
        .limit(1)
    )
    result = row.first()
    if result is None:
        raise RuntimeError(f"No active admin found for company {company_id}")
    user, company = result
    return Principal(
        user=user,
        role=ADMIN,
        rank=ROLE_RANKS[ADMIN],
        is_superadmin=False,
        company_id=company_id,
    )


async def _find_seed_company(db) -> uuid.UUID:
    from app.models.company import Company

    row = await db.scalar(
        select(Company).where(
            Company.name.like(SEED_COMPANY_NAME_LIKE),
            Company.deleted_at.is_(None),
        )
    )
    if row is None:
        raise RuntimeError(
            f"No company matching '{SEED_COMPANY_NAME_LIKE}' found in dev DB. "
            "Run: python -m app.scripts.seed_demo first."
        )
    return row.id


async def _drop_test_franchisees(db, company_id: uuid.UUID) -> None:
    codes = [code for _, code, _ in FRANCHISEES]
    rows = (
        await db.execute(
            select(Franchisee).where(
                Franchisee.company_id == company_id,
                Franchisee.code.in_(codes),
                Franchisee.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    for row in rows:
        await db.execute(
            delete(FranchiseePincode).where(
                FranchiseePincode.company_id == company_id,
                FranchiseePincode.franchisee_id == row.id,
            )
        )
        row.deleted_at = row.updated_at  # soft-delete
    await db.commit()
    print(f"  Dropped {len(rows)} existing test franchisee(s).")


async def main(company_id: uuid.UUID | None, reset: bool, dry: bool) -> None:
    async with AsyncSessionLocal() as db:
        cid = company_id or await _find_seed_company(db)
        print(f"Company id : {cid}")

        if reset:
            print("Resetting existing test franchisees …")
            await _drop_test_franchisees(db, cid)

        principal = await _admin_principal(db, cid)
        home_id = await home_franchisee_id(db, cid)
        print(f"Home franchisee: {home_id}\n")

        for name, code, ranges in FRANCHISEES:
            # Skip if already present.
            existing = await db.scalar(
                select(Franchisee).where(
                    Franchisee.company_id == cid,
                    Franchisee.code == code,
                    Franchisee.deleted_at.is_(None),
                )
            )
            if existing is not None:
                print(f"  [{code}] {name} already exists (id={existing.id}) — skipping create.")
                fid = existing.id
            else:
                req = FranchiseeCreateRequest(
                    name=name,
                    code=code,
                    kind="external",
                    contactName=f"{name} Contact",
                    contactPhone="+919000000001",
                )
                out = await franchisees_service.create_franchisee(db, principal, req)
                fid = out.id
                print(f"  [{code}] Created '{name}' -> id={fid}")

            pin_req = PincodesRequest(pincodeRanges=ranges)
            change = await franchisees_service.set_pincodes(
                db, principal, fid, pin_req, dry_run=dry
            )
            mode = "DRY-RUN" if dry else "APPLIED"
            print(
                f"         pincodes {mode}: resolved={change.resolvedCount}"
                f"  unknown={change.unknownCount}"
                f"  added={change.added.count}"
                f"  clashes={change.clashCount}"
            )
            if change.clashes:
                for c in change.clashes[:5]:
                    print(f"           CLASH: {c.pincode} owned by {c.franchiseeName}")

        # Summary
        async with AsyncSessionLocal() as db2:
            total = (
                await db2.execute(
                    select(FranchiseePincode).where(
                        FranchiseePincode.company_id == cid
                    )
                )
            ).scalars().all()
        print(f"\nfranchisee_pincodes rows for company: {len(total)}")
        print("Done.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--company-id", default=None)
    parser.add_argument("--reset", action="store_true", help="Drop test franchisees first")
    parser.add_argument("--dry", action="store_true", help="Dry-run set_pincodes (no writes)")
    args = parser.parse_args()
    cid = uuid.UUID(args.company_id) if args.company_id else None
    asyncio.run(main(cid, args.reset, args.dry))
