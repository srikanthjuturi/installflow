"""Fill an environment with one synthetic company for load testing and the demo.

    python -m app.scripts.seed_synthetic                    # dev, 50 techs, 500 tickets
    python -m app.scripts.seed_synthetic --tickets 50       # a quick rehearsal
    python -m app.scripts.seed_synthetic --plan             # what it would do, no writes

    $env:POSTGRES_DB='RelianceProdDB'
    python -m app.scripts.seed_synthetic --production       # both, or it refuses

Everything it creates hangs off ONE company, so `cleanup_db --keep <the others>`
removes the lot. The decisions behind it — including why production is in scope
at all before launch — are in `loadtest/DECISIONS.md`.

Two refusals are structural, in `seed/guards.py`: no phone number that could
reach a real person, and no production write without `--production` typed in
full. A third is at the end: the run fails if the data it just wrote does not
add up.

Since the franchisee programme the company is not a single flat tenant: the
technicians are split between the home franchisee and two carved out of its
pincodes (one external with a facility, one internal with none), every fifth
technician is an employee, travel and speed rules pay something, a spare-parts
list exists and a share of jobs wait for a part. `--plan` prints that shape and
the verdict is followed by how many rows each franchisee-era check read, so a
seed that stopped producing employees or parts cannot pass quietly (a check that
reads no rows passes on anything).

What it does NOT do, on purpose:

* upload images — five artifacts per closed job would leave files in a blob
  container both environments share and `cleanup_db` never touches;
* load `product_model_serials` — an empty list means intake does not check the
  serial, which is what lets 500 invented ones through;
* produce `Cancelled` or `AI Review` tickets — nothing in the API writes
  either, so seeding them would mean inventing a state the product cannot
  reach.
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

from app.core.database import AsyncSessionLocal  # noqa: E402
from app.scripts.seed import backdate, lifecycle, tenant, verify  # noqa: E402
from app.scripts.seed.guards import SeedRefused, assert_target_allowed  # noqa: E402

#: How far back a settled ticket is moved. Six weeks of history is enough for
#: the Earnings screen's month view to have something in it and for the
#: dashboard's counts to look like a company that has been working, without
#: pretending the company is older than the demo needs it to be.
OLDEST_DAYS = 42


def _args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tickets", type=int, default=500)
    parser.add_argument("--technicians", type=int, default=50)
    parser.add_argument(
        "--tag",
        default=datetime.datetime.now().strftime("%d%b").upper(),
        help="Disambiguates a second run — lands in the company name and GSTIN.",
    )
    parser.add_argument(
        "--production",
        action="store_true",
        help="Required to write to the production database, and refused against any other.",
    )
    parser.add_argument(
        "--plan",
        action="store_true",
        help="Print what would be created and exit without writing anything.",
    )
    parser.add_argument(
        "--random-seed",
        type=int,
        default=20260917,
        help="Fixed by default, so two runs produce the same shape.",
    )
    return parser.parse_args()


def _confirm(database: str) -> None:
    """Production only. Typing the database name is the whole ceremony."""
    print(f"\n  This writes a synthetic company into {database}.")
    print("  It must be deleted before any real user exists — see the go-live")
    print("  checklist in loadtest/DECISIONS.md.\n")
    typed = input(f"  Type the database name to continue [{database}]: ").strip()
    if typed != database:
        raise SeedRefused("Not confirmed — nothing was written.")


async def main() -> int:
    args = _args()
    database = assert_target_allowed(production=args.production)
    rng = random.Random(args.random_seed)

    print(f"\nSeeding {database}")
    print(f"  company   Seed Appliances {args.tag}")
    print(f"  staff     admin, national head, regional head, area manager")
    print(f"  vendor    Crestline Distributors {args.tag} (Meridian, Sunview)")
    print(f"  catalogue {len(tenant.CATEGORIES)} categories, "
          f"{sum(len(m) for _, m in tenant.CATEGORIES)} models")
    print(f"  people    {args.technicians} technicians")
    _, crest_codes, north_codes = tenant.split_pincodes(["x"] * 20)
    print(f"  franchise Crestline Field Services {args.tag} (external, "
          f"{len(crest_codes)} of 20 pincodes, facility), "
          f"Northgate Field Services {args.tag} (internal, "
          f"{len(north_codes)} pincodes, NO facility), home keeps the rest")
    print(f"  mix       technicians placed {' / '.join(tenant.COVERAGE_CYCLE)} in turn; "
          f"the 2nd of every 5 per franchisee is an employee")
    print(f"  money     travel free {tenant.TRAVEL_FREE_KM['freelancer']}/"
          f"{tenant.TRAVEL_FREE_KM['employee']} km, step {tenant.TRAVEL_STEP_KM} km, "
          f"Rs {tenant.TRAVEL_PAISE_PER_STEP // 100}, cap "
          f"Rs {tenant.TRAVEL_MAX_PAISE // 100}; speed {tenant.SPEED_REWARD_WITHIN_H} h "
          f"-> Rs {tenant.SPEED_REWARD_PAISE // 100}, {tenant.SPEED_PENALTY_AFTER_H} h "
          f"-> Rs {tenant.SPEED_PENALTY_PAISE // 100} (freelancers, first category)")
    print(f"  parts     {', '.join(tenant.PARTS_ON_CATEGORY)} on the first category, "
          f"{tenant.PART_ON_MODEL} on its first product")
    print(f"  tickets   {args.tickets}, mixed:")
    for intent, share in lifecycle.MIX:
        print(f"              {round(args.tickets * share):4d}  {intent}")
    if args.plan:
        print("\n--plan: nothing was written.\n")
        return 0
    if args.production:
        _confirm(database)

    started = time.monotonic()
    async with AsyncSessionLocal() as db:
        print("\n  building the company …")
        built = await tenant.build(
            db,
            tag=args.tag,
            technician_count=args.technicians,
            ticket_count=args.tickets,
            rng=rng,
        )
        print(f"  company {built.company_name} ({built.company_id})")

        def progress(done: int, total: int, outcome: lifecycle.Outcome) -> None:
            if done % 25 == 0 or done == total:
                elapsed = time.monotonic() - started
                print(f"  {done:4d}/{total}  {elapsed:6.0f}s  last: {outcome.status}")

        print("\n  raising tickets …")
        outcomes = await lifecycle.drive(
            db, built, count=args.tickets, rng=rng, on_progress=progress
        )

        handed = await lifecycle.hand_one_ticket_over(db, built, outcomes)
        print(f"  hand-over  {handed or 'no unassigned home ticket to hand over'}")

        # Backdating comes after every write to a TICKET, because any later
        # write would re-stamp `updated_at` and undo it.
        settled = [o for o in outcomes if o.settled]
        print(f"\n  moving {len(settled)} settled tickets into the past …")
        for outcome in settled:
            await backdate.shift_ticket(
                db,
                outcome.ticket_id,
                delta=datetime.timedelta(
                    days=rng.randint(1, OLDEST_DAYS),
                    hours=rng.randint(0, 23),
                ),
            )
        await db.commit()

        # After backdating, on purpose: a transfer is stamped "now", and the
        # money it leaves behind must be older than it (a transfer writes no
        # ticket or ledger row, so nothing above is disturbed).
        moved = await lifecycle.transfer_one_technician(db, built)
        print(f"  transfer   {moved or 'no technician with history and nothing to redeem'}")

        print("\n  checking what was written …")
        problems = await verify.run(db, company_id=built.company_id)
        coverage = await verify.rows_read(db, built.company_id)

    refused = [o for o in outcomes if o.status.startswith("refused")]
    print(f"\n  {len(outcomes) - len(refused)} tickets written, {len(refused)} refused")
    for outcome in refused[:5]:
        print(f"    refused ({outcome.intent}): {outcome.status}")
    if len(refused) > 5:
        print(f"    … and {len(refused) - 5} more")
    if len(refused) * 4 > len(outcomes):
        # A few refusals are real answers (a technician at the daily cap); a
        # quarter of the plan is a seed that stopped working - the vendor's
        # credit line did exactly that once, and the run still "passed".
        print(
            f"\n  FAILED: {len(refused)} of {len(outcomes)} tickets were refused - "
            "the company this left behind is mostly empty. Delete it with cleanup_db.\n"
        )
        return 1

    if problems:
        print(f"\n  FAILED {len(problems)} checks:")
        for problem in problems:
            print(f"    [{problem.check}] {problem.detail}")
        print(
            "\n  The data is written but does not add up. Delete this company "
            "with cleanup_db before using it for anything.\n"
        )
        return 1

    print("\n  what the checks read:")
    for label, n in coverage.items():
        print(f"    {n:5d}  {label}{'' if n else '   <- none: the check on this proved nothing'}")
    print(f"\n  all checks passed in {time.monotonic() - started:.0f}s")
    print(f"  company id: {built.company_id}")
    print("  run `python -m app.scripts.audit_tenancy` to confirm isolation\n")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except SeedRefused as refusal:
        print(f"\n  REFUSED: {refusal}\n")
        sys.exit(2)
