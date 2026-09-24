"""Build one small, readable company for a client walkthrough.

    python -m app.scripts.seed_demo --plan                  # what it would do, no writes
    python -m app.scripts.seed_demo                         # dev

    $env:POSTGRES_DB='RelianceProdDB'
    python -m app.scripts.seed_demo --production            # both, or it refuses

`seed_synthetic` at demo size, with names a client recognises and one known
password on every console login, so the credentials can be handed over in a
message. It reuses the same `seed/` package — every row is written through the
real services — and adds the one thing that package does not produce: a
technician's redemption, so the Redemptions screen has a request to open.

Six technicians and thirty tickets: something in every list and every status a
ticket can reach, few enough that a person can read each screen.

Console logins are EMAIL + password. Technicians sign in by OTP; the first four
carry the team's own phones (`guards.REAL_TEAM_PHONES`), and nobody outside the
team can receive their codes — for a client, the Play reviewer's fixed-code
number (`seed_play_review`) is the app login.
"""

import argparse
import asyncio
import datetime
import random
import sys
import time

if sys.platform == "win32":  # noqa: E402
    # psycopg refuses to run async on the Proactor loop Windows defaults to.
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

from app.core.credits import load_platform_settings  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.core.errors import AppError  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.features.redemptions import service as redemptions_service  # noqa: E402
from app.features.redemptions.schemas import RedeemRequest  # noqa: E402
from app.models.company import Company  # noqa: E402
from app.models.user import User  # noqa: E402
from app.scripts.seed import backdate, lifecycle, tenant, verify  # noqa: E402
from app.scripts.seed.guards import (  # noqa: E402
    SeedRefused,
    assert_target_allowed,
    synthetic_email,
)

TAG = "demo"
PASSWORD = "Demo@12345"
TECHNICIANS = 6
TICKETS = 30
OLDEST_DAYS = 30

NAMES = tenant.Names(
    company="GreenTech Demo Services",
    admin="Arjun Mehta",
    national_head="Kavita Rao",
    regional_head="Suresh Iyer",
    area_manager="Priya Reddy",
    vendor="Crestline Distributors",
    vendor_contact="Rahul Verma",
)

#: (label, email local part) — the order the credentials are printed in.
LOGINS: tuple[tuple[str, str], ...] = (
    ("Company Admin", f"admin.{TAG}"),
    ("National Head", f"nh.{TAG}"),
    ("Regional Head", f"rh.{TAG}"),
    ("Area Manager", f"am.{TAG}"),
    ("Vendor", f"vendor.{TAG}"),
)

#: Deliberately not a real PSP handle, so a QR scanned during the demo fails in
#: the payer's UPI app instead of paying a stranger.
DEMO_UPI_HANDLE = "seeddemo"


def _args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--production", action="store_true")
    parser.add_argument("--plan", action="store_true")
    parser.add_argument("--random-seed", type=int, default=20260924)
    return parser.parse_args()


async def _already_seeded(db: AsyncSession) -> bool:
    return bool(
        await db.scalar(select(Company.id).where(Company.name == NAMES.company))
    )


async def _set_passwords(db: AsyncSession) -> None:
    """One known password, because these are handed to a person in a message."""
    for _label, local in LOGINS:
        email = synthetic_email(local)
        user = await db.scalar(select(User).where(User.email == email))
        if user is None:
            raise SeedRefused(f"No account for {email} — seeding stopped.")
        user.password_hash = hash_password(PASSWORD)
    await db.commit()


async def _one_redemption(db: AsyncSession, built: tenant.Tenant) -> str:
    """The first technician with money earned asks to be paid it."""
    for profile in built.technicians:
        await db.refresh(profile)
        available = await redemptions_service.balance(
            db, company_id=built.company_id, technician_id=profile.id
        )
        amount = redemptions_service.redeemable(available)
        if amount <= 0:
            continue
        user = await redemptions_service._technician_user(db, profile)
        local = "".join(c for c in (user.full_name or "tech").lower() if c.isalnum())
        profile.upi_id = f"{local}@{DEMO_UPI_HANDLE}"
        profile.upi_name = user.full_name
        await db.commit()
        principal = await tenant.principal_for(db, user, company_id=built.company_id)
        try:
            await redemptions_service.request(
                db, principal, profile, RedeemRequest(amountPaise=amount)
            )
        except AppError as exc:
            return f"skipped ({exc})"
        return f"{user.full_name} asked for Rs {amount // 100:,}"
    return "skipped (no technician has earned anything yet)"


async def main() -> int:
    args = _args()
    database = assert_target_allowed(production=args.production)
    rng = random.Random(args.random_seed)

    print(f"\nSeeding {database}")
    print(f"  company   {NAMES.company}")
    print(f"  staff     admin, national head, regional head, area manager, vendor")
    print(f"  people    {TECHNICIANS} technicians, {TICKETS} tickets:")
    for intent, share in lifecycle.MIX:
        print(f"              {round(TICKETS * share):3d}  {intent}")
    if args.plan:
        print("\n--plan: nothing was written.\n")
        return 0

    started = time.monotonic()
    async with AsyncSessionLocal() as db:
        if await _already_seeded(db):
            raise SeedRefused(
                f"{NAMES.company!r} already exists here. Delete it with cleanup_db "
                f"before seeding it again."
            )
        platform = await load_platform_settings(db)
        recharge = bool(platform.upi_id and platform.upi_name)

        print("\n  building the company …")
        built = await tenant.build(
            db,
            tag=TAG,
            technician_count=TECHNICIANS,
            ticket_count=TICKETS,
            rng=rng,
            names=NAMES,
            recharge=recharge,
        )
        if not recharge:
            print("    note: no platform UPI ID, so no recharge — the free credits cover it")

        print("  raising tickets …")
        outcomes = await lifecycle.drive(db, built, count=TICKETS, rng=rng)

        # Last, because any later write to a ticket re-stamps `updated_at`.
        for outcome in (o for o in outcomes if o.settled):
            await backdate.shift_ticket(
                db,
                outcome.ticket_id,
                delta=datetime.timedelta(
                    days=rng.randint(1, OLDEST_DAYS), hours=rng.randint(0, 23)
                ),
            )
        await db.commit()

        redemption = await _one_redemption(db, built)
        await _set_passwords(db)
        problems = await verify.run(db, company_id=built.company_id)

    refused = [o for o in outcomes if o.status.startswith("refused")]
    counts: dict[str, int] = {}
    for outcome in outcomes:
        if not outcome.status.startswith("refused"):
            counts[outcome.status] = counts.get(outcome.status, 0) + 1
    print(f"\n  tickets   {', '.join(f'{n} {s}' for s, n in sorted(counts.items()))}")
    if refused:
        print(f"  refused   {len(refused)} — first: {refused[0].status}")
    print(f"  redeem    {redemption}")

    if problems:
        print(f"\n  FAILED {len(problems)} checks:")
        for problem in problems:
            print(f"    [{problem.check}] {problem.detail}")
        return 1

    print(f"\n  done in {time.monotonic() - started:.0f}s — company id {built.company_id}")
    print(f"\n  Console logins (password {PASSWORD}):")
    for label, local in LOGINS:
        print(f"    {label:<14} {synthetic_email(local)}")
    print("\n  Run `python -m app.scripts.audit_tenancy` to confirm isolation.\n")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except SeedRefused as refusal:
        print(f"\n  REFUSED: {refusal}\n")
        sys.exit(2)
