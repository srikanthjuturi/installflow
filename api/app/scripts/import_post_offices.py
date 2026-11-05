"""Load the India Post directory into `post_offices` (Epic 7).

    python -m app.scripts.import_post_offices                    # dry run: counts only
    python -m app.scripts.import_post_offices --apply            # write them
    python -m app.scripts.import_post_offices --file other.csv --apply

The default file is `docs/pincodes.csv` at the repo root (11 columns:
circlename, regionname, divisionname, officename, pincode, officetype, delivery,
district, statename, latitude, longitude).

Idempotent: keyed on (pincode, lower(cleaned name)), so re-running updates the
type / delivery / coordinates of offices it already has and adds new ones. It
NEVER deletes -- an office missing from a newer file stays until somebody
removes it on purpose.

Rows whose pincode is not in our geography master are skipped and counted: an
office under a code we do not hold cannot be offered, because the form only asks
for localities after a pincode that intake itself accepts. The sample of skipped
codes is printed so the master can be corrected, not the directory forced in.

⚠ Like every script here it hits the database named by the environment: the
DEVELOPMENT one unless `CONFIRM_PROD` / `POSTGRES_DB` are overridden (see
api/AGENTS.md). Production must be loaded the same way before the form relies on it.
"""

import argparse
import asyncio
import csv
import selectors
import sys
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.database import AsyncSessionLocal
from app.core.post_offices import Office, parse_row
from app.models.post_office import PostOffice
from app.models.territory import Pincode

DEFAULT_FILE = Path(__file__).resolve().parents[3] / "docs" / "pincodes.csv"
BATCH = 5000


def read_offices(path: Path) -> tuple[list[Office], int, int]:
    """(unique offices, rows rejected as unusable, exact duplicates dropped)."""
    seen: dict[tuple[str, str], Office] = {}
    rejected = duplicates = 0
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            office = parse_row(row)
            if office is None:
                rejected += 1
                continue
            key = (office.pincode, office.name_key)
            if key in seen:
                duplicates += 1
                # Keep the one that carries coordinates, if only one does.
                if seen[key].latitude is None and office.latitude is not None:
                    seen[key] = office
                continue
            seen[key] = office
    return list(seen.values()), rejected, duplicates


async def run(path: Path, apply: bool) -> int:
    if not path.exists():
        print(f"File not found: {path}")
        return 1
    offices, rejected, duplicates = read_offices(path)
    print(f"{path.name}: {len(offices):,} unique offices "
          f"({rejected:,} unusable rows, {duplicates:,} duplicates dropped)")

    async with AsyncSessionLocal() as db:
        known = set(await db.scalars(select(Pincode.code)))
        usable = [o for o in offices if o.pincode in known]
        unknown = sorted({o.pincode for o in offices if o.pincode not in known})
        print(f"{len(usable):,} sit under a pincode we hold; "
              f"{len(offices) - len(usable):,} under {len(unknown):,} codes we do not "
              f"(sample: {', '.join(unknown[:8]) or '-'})")
        before = await db.scalar(select(func.count()).select_from(PostOffice))
        print(f"post_offices currently holds {before:,}")
        if not apply:
            print("\nDry run - nothing written. Re-run with --apply.")
            return 0

        for start in range(0, len(usable), BATCH):
            chunk = usable[start : start + BATCH]
            stmt = pg_insert(PostOffice).values(
                [
                    {
                        "pincode": o.pincode,
                        "name": o.name,
                        "name_key": o.name_key,
                        "office_type": o.office_type,
                        "delivers": o.delivers,
                        "latitude": o.latitude,
                        "longitude": o.longitude,
                    }
                    for o in chunk
                ]
            )
            await db.execute(
                stmt.on_conflict_do_update(
                    constraint="uq_post_offices_pincode_name",
                    set_={
                        "office_type": stmt.excluded.office_type,
                        "delivers": stmt.excluded.delivers,
                        "latitude": stmt.excluded.latitude,
                        "longitude": stmt.excluded.longitude,
                    },
                )
            )
        await db.commit()
        after = await db.scalar(select(func.count()).select_from(PostOffice))
        print(f"Done. post_offices now holds {after:,} (+{after - before:,}).")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--file", type=Path, default=DEFAULT_FILE)
    parser.add_argument("--apply", action="store_true", help="write the offices")
    args = parser.parse_args()
    return asyncio.run(
        run(args.file, args.apply),
        loop_factory=lambda: asyncio.SelectorEventLoop(selectors.SelectSelector()),
    )


if __name__ == "__main__":
    sys.exit(main())
