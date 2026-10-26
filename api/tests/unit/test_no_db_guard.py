"""Proves the X1 guard in conftest.py actually blocks a database call.

If this ever passes by actually connecting, the whole harness proves nothing
(00-index §4.1, §6).
"""

import pytest


def test_create_async_engine_is_refused() -> None:
    import sqlalchemy.ext.asyncio as sa_asyncio

    with pytest.raises(RuntimeError, match="unit tests must not touch a database"):
        sa_asyncio.create_async_engine("postgresql+psycopg://x/y")
