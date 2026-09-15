"""Delete every company not on a keep list, and everything under it.

    python -m app.scripts.cleanup_db --keep <company-id> [--keep <company-id> ...]
    python -m app.scripts.cleanup_db --dry-run          # the plan, and nothing else
    python -m app.scripts.cleanup_db --rollback         # delete + check, then ROLL BACK
    python -m app.scripts.cleanup_db --check            # table classification only, no DB

The database is whatever `.env` names, overridden the usual way:

    $env:POSTGRES_DB='RelianceProdDB'; python -m app.scripts.cleanup_db --keep <id> --dry-run

The decisions behind every guard below are in `api/AGENTS.md` -> "Database
cleanup". The short version of what a real run does, in order:

1. Refuses unless every table in the database is classified in this file.
2. Refuses an unknown `--keep` id (a typo would otherwise delete the company it
   was meant to protect), and an empty keep list on `RelianceProdDB`.
3. Prints the plan, and refuses if any row that SURVIVES points at a row that is
   deleted — a `SET NULL` or `CASCADE` would change it silently, and no row count
   can see that.
4. Asks for the database name, then `YES`.
5. Takes a `pg_dump` into `api/backups/`, which must be git-ignored, and refuses
   to continue unless the dump exists and `pg_restore` can read it.
6. Deletes in one REPEATABLE READ transaction, children before parents, then
   re-measures every table and rolls back if anything that was kept changed.

Why children-first rather than one `DELETE FROM companies`: the cascade from
`companies` crosses fourteen `RESTRICT` foreign keys (`tickets -> vendors`,
`ledger_entries -> tickets`, ...), and whether they fire before or after the
rows referencing them are gone depends on the order Postgres happens to walk the
cascade. The order here comes from the live foreign keys, so a new table cannot
make it wrong — only unclassified, which step 1 refuses.

Blob storage is deliberately not touched: dev and production share the same
containers, so a file cleanup driven by one database could blank the other's
images. The deleted company ids are written beside the dump for whoever does it.
"""

import argparse
import glob
import os
import re
import shutil
import subprocess
import sys
import uuid
from datetime import datetime
from pathlib import Path

import psycopg

from app.core.config import settings
from app.scripts.create_database import PRODUCTION_DB

API_ROOT = Path(__file__).resolve().parents[2]
BACKUP_DIR = API_ROOT / "backups"

# ---------------------------------------------------------------------------
# Classification. EVERY table in the database appears in exactly one of these,
# or the script refuses to run. Adding a table? Put it here, then run --check.
# ---------------------------------------------------------------------------

#: Survive every run, untouched. Each needs a reason.
KEEP_TABLES: dict[str, str] = {
    "alembic_version": "migration bookkeeping",
    "regions": "geography master - global, ids shared across databases by copy_geography",
    "states": "geography master",
    "districts": "geography master",
    "pincodes": "geography master",
    "pincode_districts": "geography master",
    "platform_settings": "the platform's own configuration; belongs to no company",
    "features": "global feature catalogue, seeded by migrations",
    "role_feature_defaults": "per-role defaults, seeded by migrations",
    "roles": "global role catalogue, seeded by migrations",
}

#: Tenant tables: a row goes when its `company_id` is a deleted company.
COMPANY_TABLES: frozenset[str] = frozenset(
    {
        "company_role_features",
        "company_rules",
        "company_sequences",
        "credit_entries",
        "credit_recharges",
        "ledger_entries",
        "membership_states",
        "memberships",
        "notification_reads",
        "notifications",
        "product_model_serials",
        "product_models",
        "product_node_rules",
        "product_nodes",
        "push_tokens",
        "redemption_events",
        "redemptions",
        "technician_invite_pincodes",
        "technician_invites",
        "technician_nodes",
        "technician_pincodes",
        "technician_profiles",
        "ticket_attachments",
        "ticket_events",
        "ticket_proofs",
        "tickets",
        "upi_change_requests",
        "vendor_address_searches",
        "vendor_brands",
        "vendors",
        "web_push_subscriptions",
    }
)

#: Tables with their own rule, because they carry no `company_id`. `{t}` is the
#: table's alias; `%(deleted)s` the deleted company ids; `%(users)s` the users
#: being deleted. Each must be NULL-safe under `NOT COALESCE(..., false)`.
SPECIAL_PREDICATES: dict[str, str] = {
    "companies": "{t}.id = ANY(%(deleted)s::uuid[])",
    "users": "{t}.id = ANY(%(users)s::uuid[])",
    "refresh_tokens": "{t}.user_id = ANY(%(users)s::uuid[])",
    # Scoped through its membership, which is company-scoped.
    "membership_regions": (
        "{t}.membership_id IN (SELECT m.id FROM memberships m "
        "WHERE m.company_id = ANY(%(deleted)s::uuid[]))"
    ),
    # Issued before a company is known, so it goes with whatever it names — and
    # an unattached code (a sign-in by phone or email alone) only once expired,
    # so a kept company's technician signing in this minute is not cut off.
    "otp_codes": (
        "({t}.user_id = ANY(%(users)s::uuid[])"
        " OR {t}.ticket_id IN (SELECT x.id FROM tickets x"
        " WHERE x.company_id = ANY(%(deleted)s::uuid[]))"
        " OR {t}.invite_id IN (SELECT x.id FROM technician_invites x"
        " WHERE x.company_id = ANY(%(deleted)s::uuid[]))"
        " OR ({t}.user_id IS NULL AND {t}.ticket_id IS NULL"
        " AND {t}.invite_id IS NULL AND {t}.expires_at < now()))"
    ),
}

#: Foreign keys a SURVIVING row may hold onto a deleted row, and why that is fine.
#: Every other such reference stops the run.
ALLOWED_DANGLING_FKS: dict[tuple[str, str], str] = {
    ("users", "last_active_company_id"): (
        "the company switcher's memory - SET NULL just means the next sign-in "
        "opens their remaining company"
    ),
}

#: Money, summed over the KEPT companies before and after. A payout deleted while
#: some other row count happened to move the other way would pass a count check.
MONEY_SUMS: tuple[tuple[str, str], ...] = (
    ("ledger_entries", "amount_paise"),
    ("credit_entries", "credits"),
    ("credit_recharges", "amount_paise"),
    ("redemptions", "amount_paise"),
)

#: Columns that hold a user id with no foreign key (see `ActorMixin`). A kept row
#: naming a deleted user is the accepted cost of hard-deleting users — reported,
#: not refused.
PLAIN_USER_COLUMN = re.compile(r"^(created_by|updated_by|decided_by|.*_by_user_id|user_id)$")


def classified_tables() -> set[str]:
    return set(KEEP_TABLES) | set(COMPANY_TABLES) | set(SPECIAL_PREDICATES)


def predicate(table: str, alias: str) -> str:
    if table in SPECIAL_PREDICATES:
        return SPECIAL_PREDICATES[table].format(t=alias)
    if table in COMPANY_TABLES:
        return f"{alias}.company_id = ANY(%(deleted)s::uuid[])"
    return "false"


def classification_problems(tables: set[str], *, source: str) -> list[str]:
    problems = []
    groups = [set(KEEP_TABLES), set(COMPANY_TABLES), set(SPECIAL_PREDICATES)]
    for i, a in enumerate(groups):
        for b in groups[i + 1 :]:
            for t in sorted(a & b):
                problems.append(f"{t} is classified twice")
    for t in sorted(tables - classified_tables()):
        problems.append(f"{t} exists in {source} but is not classified in cleanup_db.py")
    stale = classified_tables() - tables - {"alembic_version"}
    for t in sorted(stale):
        problems.append(f"{t} is classified in cleanup_db.py but does not exist in {source}")
    return problems


# ---------------------------------------------------------------------------
# --check: no database, just the models.
# ---------------------------------------------------------------------------


def run_check() -> int:
    import app.db.base  # noqa: F401  registers every model on Base.metadata
    from app.db.base_class import Base

    problems = classification_problems(set(Base.metadata.tables), source="the models")
    if problems:
        print("Table classification is incomplete:")
        for p in problems:
            print(f"  - {p}")
        print("\nClassify each table in api/app/scripts/cleanup_db.py.")
        return 1
    print(f"All {len(Base.metadata.tables)} model tables are classified.")
    return 0


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------


def dsn() -> str:
    return (
        f"host={settings.POSTGRES_HOST} port={settings.POSTGRES_PORT} "
        f"dbname={settings.POSTGRES_DB} user={settings.POSTGRES_USER} "
        f"password={settings.POSTGRES_PASSWORD} sslmode={settings.POSTGRES_SSLMODE}"
    )


def is_production() -> bool:
    return settings.POSTGRES_DB.lower() == PRODUCTION_DB.lower()


def live_tables(cur: psycopg.Cursor) -> set[str]:
    cur.execute(
        "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
        "WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')"
    )
    return {r[0] for r in cur.fetchall()}


def live_foreign_keys(cur: psycopg.Cursor) -> list[tuple[str, list[str], str, list[str]]]:
    """(child, child_cols, parent, parent_cols) for every FK in `public`."""
    cur.execute(
        """
        SELECT c.conrelid::regclass::text, c.confrelid::regclass::text,
          ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(att, ord)
                JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.att
                ORDER BY k.ord),
          ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(att, ord)
                JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.att
                ORDER BY k.ord)
        FROM pg_constraint c
        WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
        ORDER BY 1, 2
        """
    )
    return [(child, ccols, parent, pcols) for child, parent, ccols, pcols in cur.fetchall()]


def tables_with_column(cur: psycopg.Cursor, column: str) -> set[str]:
    cur.execute(
        "SELECT table_name FROM information_schema.columns "
        "WHERE table_schema = 'public' AND column_name = %s",
        (column,),
    )
    return {r[0] for r in cur.fetchall()}


def scalar(cur: psycopg.Cursor, query: str, params: dict | None = None):
    cur.execute(query, params or {})
    row = cur.fetchone()
    return row[0] if row else None


def delete_order(fks, plan_tables: set[str]) -> list[str]:
    """Children before parents, over the tables this run deletes from."""
    parents: dict[str, set[str]] = {t: set() for t in plan_tables}
    for child, _, parent, _ in fks:
        if child in plan_tables and parent in plan_tables and child != parent:
            parents[child].add(parent)
    order: list[str] = []
    remaining = dict(parents)
    while remaining:
        # A table can go once nothing still waiting references it.
        ready = sorted(
            t for t in remaining if not any(t in ps for c, ps in remaining.items() if c != t)
        )
        if not ready:
            raise SystemExit(
                "Foreign keys form a cycle between: " + ", ".join(sorted(remaining))
            )
        for t in ready:
            order.append(t)
            del remaining[t]
    return order


# ---------------------------------------------------------------------------
# The plan
# ---------------------------------------------------------------------------


def resolve_sets(cur: psycopg.Cursor, keep: list[uuid.UUID]) -> tuple[list, list]:
    cur.execute(
        "SELECT id FROM companies WHERE NOT (id = ANY(%(keep)s::uuid[])) ORDER BY name, id",
        {"keep": keep},
    )
    deleted = [r[0] for r in cur.fetchall()]
    # A user survives as the superadmin, or through ANY membership row in a kept
    # company - soft-deleted ones included, because deleting that user would
    # cascade into the kept company's rows.
    cur.execute(
        """
        SELECT u.id FROM users u
        WHERE u.role <> 'superadmin'
          AND NOT EXISTS (
              SELECT 1 FROM memberships m
              WHERE m.user_id = u.id AND NOT (m.company_id = ANY(%(deleted)s::uuid[]))
          )
        ORDER BY u.id
        """,
        {"deleted": deleted},
    )
    users = [r[0] for r in cur.fetchall()]
    return deleted, users


def dangling_references(cur, fks, plan_tables, params) -> list[str]:
    """Surviving rows that reference a row about to be deleted."""
    found = []
    for child, ccols, parent, pcols in fks:
        if parent not in plan_tables:
            continue
        if len(ccols) == 1 and (child, ccols[0]) in ALLOWED_DANGLING_FKS:
            continue
        join = " AND ".join(f"c.{cc} = p.{pc}" for cc, pc in zip(ccols, pcols))
        count = scalar(
            cur,
            f'SELECT count(*) FROM "{child}" c JOIN "{parent}" p ON {join} '
            f"WHERE NOT COALESCE(({predicate(child, 'c')}), false) "
            f"AND COALESCE(({predicate(parent, 'p')}), false)",
            params,
        )
        if count:
            found.append(
                f"{count} kept row(s) in {child}({', '.join(ccols)}) point at "
                f"{parent} rows being deleted"
            )
    return found


def plain_user_references(cur, tables, fks, params) -> list[str]:
    """Kept rows whose un-keyed user columns name a deleted user."""
    fk_columns = {(child, ccols[0]) for child, ccols, _, _ in fks if len(ccols) == 1}
    cur.execute(
        "SELECT table_name, column_name FROM information_schema.columns "
        "WHERE table_schema = 'public' AND data_type = 'uuid' ORDER BY 1, 2"
    )
    notes = []
    for table, column in cur.fetchall():
        if table not in tables or not PLAIN_USER_COLUMN.match(column):
            continue
        if (table, column) in fk_columns:
            continue
        count = scalar(
            cur,
            f'SELECT count(*) FROM "{table}" t '
            f"WHERE NOT COALESCE(({predicate(table, 't')}), false) "
            f"AND t.{column} = ANY(%(users)s::uuid[])",
            params,
        )
        if count:
            notes.append(f"{count} kept row(s) in {table}.{column} name a deleted user")
    return notes


def snapshot(cur, tables, plan_tables, params, keep) -> dict[str, int]:
    """What must be true of the database afterwards, measured beforehand.

    For a table this run deletes from, the rows that will SURVIVE. For every
    other table, all of its rows. Plus money summed over the kept companies.
    """
    values: dict[str, int] = {}
    for table in sorted(tables):
        if table in plan_tables:
            values[f"rows:{table}"] = scalar(
                cur,
                f'SELECT count(*) FROM "{table}" t '
                f"WHERE NOT COALESCE(({predicate(table, 't')}), false)",
                params,
            )
        else:
            values[f"rows:{table}"] = scalar(cur, f'SELECT count(*) FROM "{table}"')
    for table, column in MONEY_SUMS:
        values[f"money:{table}.{column}"] = scalar(
            cur,
            f'SELECT COALESCE(sum({column}), 0) FROM "{table}" '
            f"WHERE company_id = ANY(%(keep)s::uuid[])",
            {"keep": keep},
        )
    return values


def after_state(cur, tables, keep) -> dict[str, int]:
    values = {f"rows:{t}": scalar(cur, f'SELECT count(*) FROM "{t}"') for t in sorted(tables)}
    for table, column in MONEY_SUMS:
        values[f"money:{table}.{column}"] = scalar(
            cur,
            f'SELECT COALESCE(sum({column}), 0) FROM "{table}" '
            f"WHERE company_id = ANY(%(keep)s::uuid[])",
            {"keep": keep},
        )
    return values


def print_plan(cur, keep, deleted, users, plan_tables, params) -> None:
    host = settings.POSTGRES_HOST
    label = "PRODUCTION" if is_production() else "not production"
    print(f"\nDatabase : {settings.POSTGRES_DB}   ({label})")
    print(f"Server   : {host}\n")

    company_summary = """
        SELECT c.id, c.name, c.is_active,
          (SELECT count(*) FROM tickets t WHERE t.company_id = c.id),
          (SELECT count(*) FROM technician_profiles p WHERE p.company_id = c.id),
          (SELECT count(DISTINCT m.user_id) FROM memberships m WHERE m.company_id = c.id),
          (SELECT max(t.created_at) FROM tickets t WHERE t.company_id = c.id)
        FROM companies c WHERE c.id = ANY(%(ids)s::uuid[]) ORDER BY c.name, c.id
    """

    def show(title: str, ids: list) -> None:
        print(f"{title} ({len(ids)})")
        if not ids:
            print("  (none)")
            return
        cur.execute(company_summary, {"ids": ids})
        for cid, name, active, tickets, techs, members, last in cur.fetchall():
            last_s = last.strftime("%Y-%m-%d") if last else "never"
            state = "" if active else "  [inactive]"
            print(f"  {name}{state}")
            print(
                f"      id {cid}   tickets {tickets}   technicians {techs}   "
                f"users {members}   last ticket {last_s}"
            )

    show("DELETE these companies", deleted)
    print()
    show("KEEP these companies", keep)

    cur.execute(
        "SELECT count(*) FILTER (WHERE id = ANY(%(users)s::uuid[])), "
        "count(*) FILTER (WHERE NOT (id = ANY(%(users)s::uuid[]))), "
        "count(*) FILTER (WHERE role = 'superadmin') FROM users",
        params,
    )
    doomed, kept, supers = cur.fetchone()
    print(f"\nUsers    : delete {doomed}, keep {kept} (superadmins: {supers})")

    print("\nRows to delete:")
    total = 0
    for table in sorted(plan_tables):
        n = scalar(
            cur,
            f'SELECT count(*) FROM "{table}" t WHERE COALESCE(({predicate(table, "t")}), false)',
            params,
        )
        if n:
            total += n
            print(f"  {table:28} {n}")
    print(f"  {'total':28} {total}")

    cleared = scalar(
        cur,
        "SELECT count(*) FROM users WHERE NOT (id = ANY(%(users)s::uuid[])) "
        "AND last_active_company_id = ANY(%(deleted)s::uuid[])",
        params,
    )
    if cleared:
        print(f"\nNote: {cleared} kept user(s) last worked in a deleted company; "
              "that pointer will be cleared.")


# ---------------------------------------------------------------------------
# Backup
# ---------------------------------------------------------------------------


def find_pg_tool(name: str, override: str | None) -> str:
    if override:
        candidate = Path(override)
        if candidate.is_dir():
            candidate = candidate / (f"{name}.exe" if sys.platform == "win32" else name)
        if candidate.is_file():
            return str(candidate)
        raise SystemExit(f"{name} not found at {candidate}")
    on_path = shutil.which(name)
    if on_path:
        return on_path
    if sys.platform == "win32":
        # A default PostgreSQL install does not add itself to PATH.
        found = glob.glob(rf"C:\Program Files\PostgreSQL\*\bin\{name}.exe")

        def version(p: str) -> float:
            m = re.search(r"PostgreSQL\\([\d.]+)\\", p)
            return float(m.group(1)) if m else 0.0

        if found:
            return max(found, key=version)
    raise SystemExit(
        f"{name} was not found on PATH or under C:\\Program Files\\PostgreSQL. "
        f"Install the PostgreSQL client tools, or pass --pg-bin <folder>."
    )


def take_backup(pg_bin: str | None, stamp: str) -> Path:
    dump = BACKUP_DIR / f"{settings.POSTGRES_DB}-{stamp}.dump"
    relative = dump.relative_to(API_ROOT).as_posix()

    # The dump holds customers' names, phones and addresses. It must never be one
    # `git add .` away from GitHub, so check the rule rather than trusting it.
    try:
        ignored = subprocess.run(
            ["git", "check-ignore", "-q", relative], cwd=API_ROOT, check=False
        ).returncode
    except FileNotFoundError:
        raise SystemExit("git is not available, so the backup folder cannot be "
                         "confirmed git-ignored. Refusing to write a dump.")
    if ignored != 0:
        raise SystemExit(f"{relative} is not git-ignored. Add `backups/` to "
                         f"api/.gitignore before running this.")

    pg_dump = find_pg_tool("pg_dump", pg_bin)
    pg_restore = find_pg_tool("pg_restore", pg_bin)
    BACKUP_DIR.mkdir(exist_ok=True)

    # Credentials go through the environment, never the command line, where any
    # other process on the machine could read them.
    env = {
        **os.environ,
        "PGHOST": settings.POSTGRES_HOST,
        "PGPORT": str(settings.POSTGRES_PORT),
        "PGDATABASE": settings.POSTGRES_DB,
        "PGUSER": settings.POSTGRES_USER,
        "PGPASSWORD": settings.POSTGRES_PASSWORD,
        "PGSSLMODE": settings.POSTGRES_SSLMODE,
    }
    print(f"\nBacking up with {pg_dump}\n  -> {dump}")
    result = subprocess.run(
        [pg_dump, "--format=custom", "--no-password", f"--file={dump}"], env=env, check=False
    )
    if result.returncode != 0:
        raise SystemExit("pg_dump failed; nothing was deleted.")
    if not dump.is_file() or dump.stat().st_size == 0:
        raise SystemExit("pg_dump produced no file; nothing was deleted.")
    listing = subprocess.run(
        [pg_restore, "--list", str(dump)], capture_output=True, text=True, check=False
    )
    if listing.returncode != 0 or "TABLE DATA" not in listing.stdout:
        raise SystemExit("pg_restore cannot read the dump; nothing was deleted.")
    print(f"  ok, {dump.stat().st_size:,} bytes, readable by pg_restore")
    return dump


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def parse_keep(values: list[str]) -> list[uuid.UUID]:
    ids = []
    for value in values:
        for part in value.split(","):
            part = part.strip()
            if not part:
                continue
            try:
                ids.append(uuid.UUID(part))
            except ValueError:
                raise SystemExit(f"--keep expects company ids; {part!r} is not a UUID")
    return sorted(set(ids), key=str)


def ask(prompt: str) -> str:
    try:
        return input(prompt)
    except EOFError:
        return ""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--keep", action="append", default=[], metavar="COMPANY_ID",
                        help="a company to keep; repeat, or comma-separate")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true",
                      help="print the plan and exit: no dump, no prompts, no deletes")
    mode.add_argument("--rollback", action="store_true",
                      help="run every delete and check, then roll back: no dump, no prompts")
    mode.add_argument("--check", action="store_true",
                      help="check table classification against the models; no database")
    parser.add_argument("--pg-bin", help="folder holding pg_dump and pg_restore")
    args = parser.parse_args()

    if args.check:
        return run_check()

    keep = parse_keep(args.keep)
    if not keep and is_production():
        print(f"Refusing: an empty keep list on {settings.POSTGRES_DB} would delete "
              f"every company in production. Pass --keep <company-id>.")
        return 1

    # NOT `with psycopg.connect(...) as conn`: that block COMMITS on a normal exit,
    # so one early `return` added later would commit a half-finished delete.
    # Closing without committing rolls back; `conn.commit()` below is the only
    # way anything is kept.
    try:
        conn = psycopg.connect(dsn(), connect_timeout=30)
    except psycopg.OperationalError as exc:
        print(f"Could not connect to {settings.POSTGRES_DB} on {settings.POSTGRES_HOST}. "
              f"Nothing was read or deleted.\n  {exc}")
        return 1
    try:
        return run(conn, args, keep)
    finally:
        conn.close()


def run(conn: psycopg.Connection, args: argparse.Namespace, keep: list[uuid.UUID]) -> int:
    conn.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
    # ---- plan, read-only ------------------------------------------------
    with conn.cursor() as cur:
        cur.execute("SET TRANSACTION READ ONLY")
        tables = live_tables(cur)
        problems = classification_problems(tables, source="the database")
        with_company = tables_with_column(cur, "company_id")
        for t in sorted(COMPANY_TABLES & tables):
            if t not in with_company:
                problems.append(f"{t} is classified per-company but has no company_id")
        if problems:
            print("Refusing: table classification is incomplete.")
            for p in problems:
                print(f"  - {p}")
            return 1

        cur.execute("SELECT id FROM companies WHERE id = ANY(%(k)s::uuid[])", {"k": keep})
        found = {r[0] for r in cur.fetchall()}
        missing = [k for k in keep if k not in found]
        if missing:
            print("Refusing: these --keep ids are not companies in "
                  f"{settings.POSTGRES_DB}:")
            for m in missing:
                print(f"  - {m}")
            return 1

        deleted, users = resolve_sets(cur, keep)
        params = {"deleted": deleted, "users": users}
        fks = live_foreign_keys(cur)
        plan_tables = (COMPANY_TABLES | set(SPECIAL_PREDICATES)) & tables
        print_plan(cur, keep, deleted, users, plan_tables, params)

        blockers = dangling_references(cur, fks, plan_tables, params)
        notes = plain_user_references(cur, tables, fks, params)
    conn.rollback()

    if notes:
        print("\nAccepted cost - author ids that will name nobody:")
        for n in notes:
            print(f"  - {n}")
    if blockers:
        print("\nRefusing: rows that survive reference rows that would be deleted.")
        for b in blockers:
            print(f"  - {b}")
        print("A SET NULL or CASCADE would change the kept rows silently. Resolve these "
              "first, or keep the company they point into.")
        return 1
    if not deleted and not users:
        print("\nNothing to delete.")
        return 0
    if args.dry_run:
        print("\nDry run: nothing was deleted.")
        return 0

    # ---- confirmation and backup ---------------------------------------
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dump = None
    if not args.rollback:
        print()
        typed = ask(f"Type the database name to continue ({settings.POSTGRES_DB}): ")
        if typed.strip() != settings.POSTGRES_DB:
            print("Database name did not match. Nothing was deleted.")
            return 1
        if ask("Type YES to delete the rows above: ").strip() != "YES":
            print("Not confirmed. Nothing was deleted.")
            return 1
        dump = take_backup(args.pg_bin, stamp)

    # ---- delete, measure, commit or roll back --------------------------
    order = delete_order(fks, plan_tables)
    self_fks = {child: (ccols, pcols) for child, ccols, parent, pcols in fks
                if child == parent and child in plan_tables}
    with conn.cursor() as cur:
        cur.execute("SET LOCAL lock_timeout = '15s'")
        # The plan was read in another transaction. Anything that changed in
        # between - a company registered a second ago - stops the run rather
        # than being deleted unseen.
        if resolve_sets(cur, keep) != (deleted, users):
            conn.rollback()
            print("Refusing: companies or users changed since the plan was printed. "
                  "Nothing was deleted; run it again.")
            return 1
        if dangling_references(cur, fks, plan_tables, params):
            conn.rollback()
            print("Refusing: new dangling references appeared. Nothing was deleted.")
            return 1

        expected = snapshot(cur, tables, plan_tables, params, keep)

        print("\nDeleting")
        for table in order:
            where = predicate(table, f'"{table}"')
            removed = 0
            if table in self_fks:
                # Leaves first, so a RESTRICT on the table's own rows
                # (ledger reversals, the manager tree) is never tripped.
                ccols, pcols = self_fks[table]
                ref = " AND ".join(f"c.{cc} = \"{table}\".{pc}"
                                   for cc, pc in zip(ccols, pcols))
                while True:
                    cur.execute(
                        f'DELETE FROM "{table}" WHERE COALESCE(({where}), false) '
                        f'AND NOT EXISTS (SELECT 1 FROM "{table}" c WHERE {ref})',
                        params,
                    )
                    removed += cur.rowcount
                    if cur.rowcount == 0:
                        break
            cur.execute(f'DELETE FROM "{table}" WHERE COALESCE(({where}), false)', params)
            removed += cur.rowcount
            if removed:
                print(f"  {table:28} {removed}")

        actual = after_state(cur, tables, keep)
        failures = [
            f"{key}: expected {expected[key]}, found {actual.get(key)}"
            for key in expected
            if expected[key] != actual.get(key)
        ]
        orphans = scalar(
            cur,
            "SELECT count(*) FROM users u WHERE u.role <> 'superadmin' AND NOT EXISTS "
            "(SELECT 1 FROM memberships m WHERE m.user_id = u.id)",
        )
        if orphans:
            failures.append(f"{orphans} non-superadmin user(s) left with no membership")
        if not scalar(cur, "SELECT count(*) FROM users WHERE role = 'superadmin'"):
            failures.append("no superadmin would remain - nobody could sign in")

        if failures:
            conn.rollback()
            print("\nCHECKS FAILED - everything was rolled back:")
            for f in failures:
                print(f"  - {f}")
            return 1

        print(f"\nChecks passed: {len(expected)} measurements unchanged, no orphan users, "
              "superadmin present.")
        if args.rollback:
            conn.rollback()
            print("Rollback mode: nothing was committed.")
            return 0
        conn.commit()

    ids_file = BACKUP_DIR / f"{settings.POSTGRES_DB}-{stamp}.deleted-companies.txt"
    ids_file.write_text("".join(f"{d}\n" for d in deleted), encoding="utf-8")
    print(f"\nCommitted. Backup: {dump}")
    print(f"Deleted company ids (for a later blob cleanup): {ids_file}")
    print("\nNext: python -m app.scripts.audit_tenancy, then sign in as the superadmin"
          + (" and a kept company's admin." if keep else "."))
    return 0


if __name__ == "__main__":
    sys.exit(main())
