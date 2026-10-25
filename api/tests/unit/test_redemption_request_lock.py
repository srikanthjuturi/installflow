"""`redemptions.service.request` re-reads the technician profile under lock.

Without `populate_existing` the session's identity map returns the caller's
stale object, so a transfer committed since it was loaded is invisible and the
redemption stamps the OLD franchisee. Pure: a stub session records the
statement, then stops the function once it is past the lock.
"""

import asyncio
import inspect
import uuid
from types import SimpleNamespace

import pytest

from app.features.redemptions import service


class _Stop(Exception):
    pass


class _Db:
    def __init__(self, locked):
        self.locked = locked
        self.stmts = []

    async def scalar(self, stmt):
        self.stmts.append(stmt)
        if len(self.stmts) == 1:
            return self.locked
        raise _Stop  # past the lock: not what this file is about


def test_the_lock_select_carries_populate_existing_and_for_update() -> None:
    company = uuid.uuid4()
    stale = SimpleNamespace(
        id=uuid.uuid4(), company_id=company, franchisee_id=uuid.uuid4()
    )
    locked = SimpleNamespace(
        id=stale.id, company_id=company, franchisee_id=uuid.uuid4(),
        technician_type="freelancer", upi_id="a@b",
    )
    db = _Db(locked)
    with pytest.raises(_Stop):
        asyncio.run(
            service.request(
                db, SimpleNamespace(user_id=uuid.uuid4()), stale,
                SimpleNamespace(amountPaise=1),
            )
        )
    stmt = db.stmts[0]
    assert stmt._execution_options.get("populate_existing") is True
    assert stmt._for_update_arg is not None


def test_the_stamped_franchisee_is_read_from_the_locked_row() -> None:
    src = inspect.getsource(service.request)
    assert "franchisee_id=locked.franchisee_id" in src
    assert "profile.franchisee_id" not in src
