"""The X1 wall: unit tests must not touch a database (00-index §4.1).

Placeholder env vars are set here, as MODULE BODY code, before `app` is ever
imported — `app/core/config.py` builds `Settings()` at import time and fails
without POSTGRES_HOST / POSTGRES_DB / POSTGRES_USER / POSTGRES_PASSWORD /
JWT_SECRET_KEY present. `setdefault` leaves a real `.env` or a real shell
environment untouched; pydantic-settings ranks an environment variable above
the `.env` file, so these placeholders win over whatever a developer's own
`.env` says, without editing it.
"""

import os

os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_DB", "unit")
os.environ.setdefault("POSTGRES_USER", "unit")
os.environ.setdefault("POSTGRES_PASSWORD", "unit")
os.environ.setdefault("JWT_SECRET_KEY", "unit-test-secret")

import psycopg
import pytest
from sqlalchemy.ext import asyncio as sa_asyncio


def _refuse(*args: object, **kwargs: object) -> None:
    raise RuntimeError("unit tests must not touch a database (00-index X1)")


@pytest.fixture(autouse=True)
def no_database(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sa_asyncio, "create_async_engine", _refuse)
    monkeypatch.setattr(psycopg, "connect", _refuse)
    monkeypatch.setattr(psycopg.AsyncConnection, "connect", _refuse)
