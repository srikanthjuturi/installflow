"""Copy the geography master from one database to another.

    python -m app.scripts.copy_geography --to RelianceProdDB

The geography master — regions, states, districts, pincodes and the
pincode/district join — is **global reference data**: it carries no
`company_id`, it is the same India for every company, and it is the one large
dataset with no seeder. `alembic upgrade head` creates the tables empty and
seeds only the five regions; the other 41,000 rows arrive from a spreadsheet
uploaded through Super Admin -> Geography.

Re-uploading that sheet into a second database works, but it mints fresh UUIDs,
so the same district would have different ids in dev and prod and a pincode id
in a bug report would mean two different things. Copying keeps them identical.

Three things this gets right that a hand-written INSERT would not:

1. **The five seeded regions in the target are replaced, not reused.**
   `regions.id` is `gen_random_uuid()`, so the rows the initial migration seeded
   into the target have DIFFERENT ids from the source's — even though both say
   NORTH/SOUTH/EAST/WEST/CENTRAL. Reusing them would orphan every `region_id`
   on `states`. The target's five rows are deleted and the source's inserted
   with the source's ids, after which everything downstream copies verbatim.

2. **`created_by` / `updated_by` are left NULL.** They are plain nullable UUID
   columns, not foreign keys, so copying them would succeed and leave ids
   pointing at users who do not exist in the target.

3. **It refuses a target that is already in use.** Replacing regions means
   deleting them, and a region with an area manager hanging off it is not
   something to discover halfway through. `--force` overrides, and then the
   whole copy runs in one transaction so a failure leaves nothing behind.
"""

import argparse
import sys

import psycopg

from app.core.config import settings

#: Copy order is FK order: a child never lands before its parent. The column
#: lists deliberately omit `created_by` / `updated_by` — see the docstring.
TABLES: list[tuple[str, str]] = [
    ("regions", "id, code, name, sort_order, is_active, created_at, updated_at"),
    ("states", "id, region_id, name, is_active, created_at, updated_at"),
    ("districts", "id, state_id, name, created_at, updated_at"),
    ("pincodes", "code, state_id, is_active, created_at, updated_at"),
    ("pincode_districts", "pincode_code, district_id, created_at, updated_at"),
]

#: Anything here in the target means the geography is already load-bearing and
#: deleting regions would either fail on a foreign key or quietly strand a
#: manager's territory.
OCCUPIED_BY: list[str] = [
    "states",
    "districts",
    "pincodes",
    "pincode_districts",
    "membership_regions",
    "membership_states",
    "technician_pincodes",
    "technician_invite_pincodes",
]


def dsn(database: str) -> str:
    """Server and credentials from `.env`; only the database name varies."""
    return (
        f"host={settings.POSTGRES_HOST} "
        f"port={settings.POSTGRES_PORT} "
        f"dbname={database} "
        f"user={settings.POSTGRES_USER} "
        f"password={settings.POSTGRES_PASSWORD} "
        f"sslmode={settings.POSTGRES_SSLMODE}"
    )


def counts(conn: psycopg.Connection, tables: list[str]) -> dict[str, int]:
    out: dict[str, int] = {}
    with conn.cursor() as cur:
        for table in tables:
            cur.execute(f'SELECT count(*) FROM "{table}"')  # noqa: S608 - fixed list
            out[table] = cur.fetchone()[0]  # type: ignore[index]
    return out


def copy_table(
    src: psycopg.Connection, dst: psycopg.Connection, table: str, cols: str
) -> None:
    """Stream one table across, in Postgres' binary COPY format.

    Binary rather than text because both ends are the same server and the same
    major version, and it keeps timestamps and UUIDs from making a round trip
    through strings.
    """
    read = f'COPY (SELECT {cols} FROM "{table}") TO STDOUT (FORMAT BINARY)'  # noqa: S608
    write = f'COPY "{table}" ({cols}) FROM STDIN (FORMAT BINARY)'
    with src.cursor().copy(read) as out, dst.cursor().copy(write) as into:
        for block in out:
            into.write(block)


def copy_geography(source: str, target: str, force: bool) -> int:
    if source == target:
        print(f"Source and target are the same database ({source}). Nothing to do.")
        return 1

    with psycopg.connect(dsn(source), connect_timeout=30) as src, psycopg.connect(
        dsn(target), connect_timeout=30
    ) as dst:
        before = counts(dst, OCCUPIED_BY)
        occupied = {t: n for t, n in before.items() if n}
        if occupied and not force:
            print(f"{target} is not empty of geography:")
            for table, n in occupied.items():
                print(f"  {table}: {n} rows")
            print(
                "\nCopying replaces the regions, which means deleting them, and "
                "these rows depend on them. Re-run with --force if you are sure "
                "the target is a scratch database."
            )
            return 1

        source_counts = counts(src, [t for t, _ in TABLES])
        print(f"Copying geography  {source} -> {target}")
        for table, _ in TABLES:
            print(f"  {table}: {source_counts[table]:,} rows")

        # One transaction: psycopg opens it on the first statement and the
        # context manager commits on a clean exit, so a failure anywhere leaves
        # the target exactly as it was.
        with dst.cursor() as cur:
            for table, _ in reversed(TABLES):
                cur.execute(f'DELETE FROM "{table}"')  # noqa: S608 - fixed list
        for table, cols in TABLES:
            copy_table(src, dst, table, cols)
            print(f"  copied {table}")

    # Re-open to read committed state rather than trusting the write side.
    with psycopg.connect(dsn(target), connect_timeout=30) as check:
        after = counts(check, [t for t, _ in TABLES])

    print(f"\n{'table':<20} {'source':>10} {'target':>10}")
    mismatched = False
    for table, _ in TABLES:
        ok = source_counts[table] == after[table]
        mismatched = mismatched or not ok
        flag = "" if ok else "   MISMATCH"
        print(f"{table:<20} {source_counts[table]:>10,} {after[table]:>10,}{flag}")

    if mismatched:
        print("\nRow counts disagree — the copy did not land cleanly.")
        return 1
    print("\nGeography copied.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--to", dest="target", required=True, help="database to copy INTO"
    )
    parser.add_argument(
        "--from",
        dest="source",
        default=settings.POSTGRES_DB,
        help=f"database to copy FROM (default: {settings.POSTGRES_DB}, from .env)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="copy even though the target already holds geography",
    )
    args = parser.parse_args()
    return copy_geography(args.source, args.target, args.force)


if __name__ == "__main__":
    sys.exit(main())
