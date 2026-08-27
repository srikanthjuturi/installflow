"""Create a database on the configured Postgres server.

    python -m app.scripts.create_database --name RelianceProdDB

We run dev and production as two databases on ONE Azure server:
`RelianceDB` is development, `RelianceProdDB` is production. A second database
on the same server inherits the server's firewall rules, so standing one up
needs no portal access — only a role with CREATEDB, which `appuser` has.

Two things this script exists to get right, both of which are easy to lose in a
hand-typed statement:

1. **The name is quoted.** Our names are mixed case, and an unquoted
   `CREATE DATABASE RelianceProdDB` folds to `relianceproddb` — a database that
   succeeds in being created, answers connections, and is not the one anything
   else in the repo is configured to use. The identifier goes through
   `psycopg.sql.Identifier`.

2. **Autocommit.** `CREATE DATABASE` cannot run inside a transaction block, and
   psycopg opens one for you by default.

It connects to the `postgres` maintenance database rather than the one in
`.env`, because you cannot create a database from inside itself. Safe to run
repeatedly — an existing database is reported and left alone.
"""

import argparse
import sys

import psycopg
from psycopg import sql

from app.core.config import settings

#: The production database. Kept here so the name is written once on this side;
#: `scripts/publish.py` holds its own copy for the deploy guard, because it runs
#: standalone and never imports the app.
PRODUCTION_DB = "RelianceProdDB"


def maintenance_dsn() -> str:
    """A connection to `postgres`, using the credentials from `.env`.

    Everything but the database name comes from settings, so this always targets
    the same server the app talks to — there is no second place to keep a host
    or a password in step.
    """
    return (
        f"host={settings.POSTGRES_HOST} "
        f"port={settings.POSTGRES_PORT} "
        f"dbname=postgres "
        f"user={settings.POSTGRES_USER} "
        f"password={settings.POSTGRES_PASSWORD} "
        f"sslmode={settings.POSTGRES_SSLMODE}"
    )


def create_database(name: str) -> int:
    with psycopg.connect(maintenance_dsn(), connect_timeout=30, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT rolcreatedb FROM pg_roles WHERE rolname = current_user")
            row = cur.fetchone()
            if row is None or not row[0]:
                print(
                    f"{settings.POSTGRES_USER} does not have CREATEDB on "
                    f"{settings.POSTGRES_HOST}. Ask for the privilege, or have "
                    f"somebody with it create {name!r}."
                )
                return 1

            # datname is compared verbatim: Postgres stores what the quoted
            # identifier said, so 'RelianceProdDB' and 'reliancedb' are two
            # different databases and only an exact match means "already there".
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,))
            if cur.fetchone() is not None:
                print(f"Database already exists: {name}")
                return 0

            cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
            print(f"Created database: {name} on {settings.POSTGRES_HOST}")

            cur.execute(
                "SELECT datname, pg_get_userbyid(datdba) FROM pg_database "
                "WHERE datistemplate = false ORDER BY datname"
            )
            print("\nDatabases on this server:")
            for datname, owner in cur.fetchall():
                marker = ""
                if datname == settings.POSTGRES_DB:
                    marker = "  <- this .env"
                elif datname == PRODUCTION_DB:
                    marker = "  <- production"
                print(f"  {datname}  (owner {owner}){marker}")
            return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--name",
        default=PRODUCTION_DB,
        help=f"database to create (default: {PRODUCTION_DB})",
    )
    args = parser.parse_args()
    return create_database(args.name)


if __name__ == "__main__":
    sys.exit(main())
