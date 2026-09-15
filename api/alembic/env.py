import asyncio
import os
import sys
import warnings
from logging.config import fileConfig

# psycopg's async driver cannot run on Windows' default ProactorEventLoop.
if sys.platform == "win32":
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from alembic import context

# Make `app` importable and pull in project config + metadata.
from app.core.config import settings
from app.db.base import Base  # imports Base with every model registered

config = context.config

# Dev and production are two databases on ONE Azure Postgres server, and
# `$env:POSTGRES_DB='RelianceProdDB'` is all it takes to point a plain
# `alembic upgrade head` at production — one env var, no other friction. That
# used to be documented as a warning only (AGENTS.md, .env.example); it wasn't
# enough, because a copy-pasted command or bad muscle memory reads exactly
# like the safe one. This makes it structural: touching production locally
# needs a second, unmistakable opt-in on top of naming the database.
#
# CI does not go through this at all — the dev and prod workflows each carry
# their own DATABASE_URL from an environment-scoped GitHub secret and never
# set POSTGRES_DB by hand, so nothing here should ever have to fire there.
_PRODUCTION_DB = "RelianceProdDB"
if settings.POSTGRES_DB == _PRODUCTION_DB and os.environ.get("CONFIRM_PROD") != "yes-i-mean-it":
    print(
        f"\nREFUSING: POSTGRES_DB={_PRODUCTION_DB} but CONFIRM_PROD is not set.\n"
        "This would run a migration against PRODUCTION from a local terminal.\n"
        "If that is really what you mean to do:\n\n"
        "  $env:CONFIRM_PROD='yes-i-mean-it'; $env:POSTGRES_DB='RelianceProdDB'; "
        "alembic upgrade head\n",
        file=sys.stderr,
    )
    sys.exit(1)

# NB: the DB URL is taken directly from app settings (below), NOT written into
# the ConfigParser — the URL-encoded password contains '%', which ConfigParser
# would treat as interpolation syntax.

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=settings.DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=True,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = create_async_engine(
        settings.DATABASE_URL,
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
