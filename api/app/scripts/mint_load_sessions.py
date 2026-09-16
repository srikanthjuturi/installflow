"""Mint real sign-in sessions for a seeded company, for Locust to use.

    python -m app.scripts.mint_load_sessions --company <id>
    python -m app.scripts.mint_load_sessions --company <id> --per-technician 3 --intake-credits 3000

    $env:POSTGRES_DB='RelianceProdDB'
    python -m app.scripts.mint_load_sessions --company <id> --production

Writes `loadtest/.sessions/<database>.json`, which is git-ignored and must stay
that way: every entry in it is a live refresh token.

Why sessions are minted rather than signed in for: technician sign-in is OTP,
throttled per phone and per IP, and production refuses to echo a code. A load
test that signed in 150 users from one laptop would measure the throttle.
`issue_session` is the same function a successful OTP, password or Google
sign-in ends in, so what comes back is indistinguishable from a real login.

⚠ Refresh tokens ROTATE — presenting one revokes it and issues a new pair. Two
Locust users sharing one session would sign each other out on the first
refresh, so every simulated user gets a session of its own, and a technician
simulated three times holds three.

Only a SYNTHETIC company is accepted: the script refuses any company whose name
does not start with the seed's prefix, so it cannot be pointed at a real tenant
and hand out its users' sessions.
"""

import argparse
import asyncio
import json
import sys
import uuid
from pathlib import Path

if sys.platform == "win32":  # noqa: E402
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy import select  # noqa: E402

from app.core.database import AsyncSessionLocal  # noqa: E402
from app.features.auth.service import issue_session  # noqa: E402
from app.models.company import Company  # noqa: E402
from app.models.membership import Membership  # noqa: E402
from app.models.product import ProductModel, ProductNode  # noqa: E402
from app.models.role import ADMIN, AREA_MANAGER, VENDOR  # noqa: E402
from app.models.technician import TechnicianPincode, TechnicianProfile  # noqa: E402
from app.models.user import User  # noqa: E402
from app.scripts.seed.guards import SeedRefused, assert_target_allowed  # noqa: E402
from app.scripts.seed.tenant import (  # noqa: E402
    SEED_COMPANY_PREFIX,
    top_up_credits,
    principal_for,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
OUT_DIR = REPO_ROOT / "loadtest" / ".sessions"


def _args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--company", required=True, type=uuid.UUID)
    parser.add_argument(
        "--per-technician",
        type=int,
        default=3,
        help="Sessions per technician — one per simulated user, since refresh rotates.",
    )
    parser.add_argument("--vendor-sessions", type=int, default=20)
    parser.add_argument("--console-sessions", type=int, default=5)
    parser.add_argument(
        "--intake-credits",
        type=int,
        default=0,
        help="Recharge this many credits first, so tickets raised under load are not refused.",
    )
    parser.add_argument("--production", action="store_true")
    return parser.parse_args()


async def _sessions(db, user: User, count: int) -> list[dict]:
    out = []
    for _ in range(count):
        login = await issue_session(db, user)
        out.append(
            {
                "accessToken": login.accessToken,
                "refreshToken": login.refreshToken,
            }
        )
    return out


async def _user_with_role(db, company_id: uuid.UUID, role: str) -> User:
    user = await db.scalar(
        select(User)
        .join(Membership, Membership.user_id == User.id)
        .where(
            Membership.company_id == company_id,
            Membership.deleted_at.is_(None),
            User.role == role,
            User.deleted_at.is_(None),
        )
        .limit(1)
    )
    if user is None:
        raise SeedRefused(f"The company has no {role} to mint sessions for.")
    return user


async def main() -> int:
    args = _args()
    database = assert_target_allowed(production=args.production)

    async with AsyncSessionLocal() as db:
        company = await db.get(Company, args.company)
        if company is None:
            raise SeedRefused(f"No company {args.company} in {database}.")
        if not company.name.startswith(SEED_COMPANY_PREFIX):
            raise SeedRefused(
                f"{company.name!r} is not a seeded company. Sessions are only "
                f"minted for companies named '{SEED_COMPANY_PREFIX}…'."
            )

        admin_user = await _user_with_role(db, company.id, ADMIN)
        if args.intake_credits:
            admin = await principal_for(db, admin_user, company_id=company.id)
            await top_up_credits(db, admin=admin, credits=args.intake_credits)
            print(f"  recharged {args.intake_credits} credits for intake under load")

        # ── technicians ──
        technicians = []
        profiles = await db.scalars(
            select(TechnicianProfile).where(
                TechnicianProfile.company_id == company.id,
                TechnicianProfile.status == "active",
            )
        )
        for profile in profiles:
            user = await db.scalar(
                select(User)
                .join(Membership, Membership.user_id == User.id)
                .where(Membership.id == profile.membership_id)
            )
            for session in await _sessions(db, user, args.per_technician):
                technicians.append({"code": profile.code, **session})

        # ── the vendor, and what it may raise ──
        vendor_user = await _user_with_role(db, company.id, VENDOR)
        vendors = await _sessions(db, vendor_user, args.vendor_sessions)
        pincodes = sorted(
            set(
                await db.scalars(
                    select(TechnicianPincode.pincode).where(
                        TechnicianPincode.company_id == company.id
                    )
                )
            )
        )
        catalogue = [
            {
                "subcategoryId": str(node_id),
                "modelId": str(model_id),
                "serviceTypes": list(service_types),
            }
            for node_id, model_id, service_types in (
                await db.execute(
                    select(ProductNode.id, ProductModel.id, ProductModel.service_types)
                    .join(ProductModel, ProductModel.node_id == ProductNode.id)
                    .where(
                        ProductNode.company_id == company.id,
                        ProductModel.deleted_at.is_(None),
                        ProductModel.is_active.is_(True),
                    )
                )
            ).all()
        ]

        # ── console staff ──
        # An area manager, because the escalation queue is AreaManagerUp and it
        # is the lowest rank that reads everything the dashboard shows.
        console_user = await _user_with_role(db, company.id, AREA_MANAGER)
        console = await _sessions(db, console_user, args.console_sessions)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{database}.json"
    out.write_text(
        json.dumps(
            {
                "database": database,
                "companyId": str(company.id),
                "companyName": company.name,
                "technicians": technicians,
                "vendors": vendors,
                "console": console,
                "intake": {"pincodes": pincodes, "catalogue": catalogue},
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(
        f"  {len(technicians)} technician, {len(vendors)} vendor and "
        f"{len(console)} console sessions → {out}"
    )
    print("  ⚠ that file holds live refresh tokens — it is git-ignored; keep it so.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except SeedRefused as refusal:
        print(f"\n  REFUSED: {refusal}\n")
        sys.exit(2)
