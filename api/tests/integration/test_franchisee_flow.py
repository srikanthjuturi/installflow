"""Integration tests for the franchisee flow (Tasks 01-03).

Run with:
    cd api
    python -m pytest tests/integration/test_franchisee_flow.py -v

Hits RelianceDB (dev only).  conftest.py cleans up "IntTest *" franchisees
before and after each session so the suite is idempotent.

Pincode ranges used (Mumbai 400xxx — not claimed by the seed):
  each test uses its own non-overlapping slice so parallel runs don't clash.

Coverage
--------
[F1]  Home franchisee is created with the company: is_home=True, code=HOME
[F2]  Bad range grammar is rejected with 422
[F3a] Pincode overlap on live apply -> 409 PINCODE_CLASH
[F3b] Pincode overlap on dry-run shows clashes without rejecting
[F4]  franchisee_for_pincode falls back to home for unowned pincodes
[F5]  Dry-run previews without writing franchisee_pincodes rows
[F6]  Live set_pincodes writes rows; routing returns the owner afterwards
[F7]  Editing home franchisee pincodes is refused (FRANCHISEE_HOME_IMMUTABLE)
[F8]  Inactive franchisee cannot receive pincodes (409)
[R3]  Deactivating the sole active admin of a non-home franchisee is refused
[T1]  Guessed franchisee id -> 404 not 403 or 500
[T2]  List is scoped to the calling company (home is always present)
[T3]  activate/deactivate with unknown id -> 404 not 500
[C1]  Empty range string clears all pincodes back to home
"""

import asyncio
import sys
import uuid

import pytest

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy import select, text

from app.core.database import AsyncSessionLocal
from app.core.deps import Principal
from app.core.franchise import franchisee_for_pincode, home_franchisee_id
from app.features.franchisees import service as svc
from app.features.franchisees.schemas import (
    FranchiseeAdminIn,
    FranchiseeCreateRequest,
    PincodesRequest,
)
from app.models.company import Company
from app.models.franchisee import Franchisee, HOME_CODE
from app.models.membership import Membership
from app.core.schemas import ListParams
from app.models.role import ADMIN, ROLE_RANKS
from app.models.user import User

# ---------------------------------------------------------------------------
# Safe pincode slices — Mumbai 400xxx, not in seed (110/500/560)
# Each test gets its own non-overlapping 5-code slice to avoid inter-test clash
# ---------------------------------------------------------------------------
_PIN = {
    "F4":        "400001",
    "F5":        "400002-400006",
    "F6":        "400007-400011",
    "ROUTE":     "400012",
    "F3a_A":     "400013-400017",
    "F3a_B":     "400013-400017",   # same range -> clash
    "F3b_A":     "400018-400022",
    "F3b_B":     "400018-400022",   # same range -> dry-run clash
    "F7":        "400023-400027",   # claimed by home test (should be refused)
    "F8":        "400028-400032",
    "CLEAR":     "400033-400037",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _find_seed_company(db) -> uuid.UUID:
    row = await db.scalar(
        select(Company).where(
            Company.name.like("Seed Appliances%"),
            Company.deleted_at.is_(None),
        )
    )
    assert row is not None, "Run `python -m app.scripts.seed_demo` first"
    return row.id


async def _admin_principal(db, company_id: uuid.UUID) -> Principal:
    user = await db.scalar(
        select(User)
        .join(Membership, Membership.user_id == User.id)
        .where(
            Membership.company_id == company_id,
            User.role == ADMIN,
            User.is_active.is_(True),
            Membership.is_active.is_(True),
        )
        .limit(1)
    )
    assert user is not None
    return Principal(
        user=user,
        role=ADMIN,
        rank=ROLE_RANKS[ADMIN],
        is_superadmin=False,
        company_id=company_id,
    )


async def _setup(db):
    cid = await _find_seed_company(db)
    principal = await _admin_principal(db, cid)
    home_id = await home_franchisee_id(db, cid)
    return principal, cid, home_id


def _ext_req(label: str = "") -> FranchiseeCreateRequest:
    tag = label or uuid.uuid4().hex[:6]
    return FranchiseeCreateRequest(
        name=f"IntTest {tag}",
        kind="external",
        contactName="Test Contact",
        contactPhone="+919000000099",
    )


def run(coro):
    """Run an async coroutine that may commit its own data (services do this).
    Tests commit freely; conftest.py cleans up IntTest franchisees at session end."""
    asyncio.run(coro)


# ---------------------------------------------------------------------------
# [F1] Home franchisee
# ---------------------------------------------------------------------------

def test_home_franchisee_exists():
    async def _t():
        async with AsyncSessionLocal() as db:
            principal, cid, home_id = await _setup(db)
            home = await db.scalar(
                select(Franchisee).where(
                    Franchisee.id == home_id,
                    Franchisee.company_id == cid,
                )
            )
            assert home is not None
            assert home.is_home is True
            assert home.code == HOME_CODE
            assert home.kind == "internal"
            assert home.is_active is True
            assert home.deleted_at is None
    run(_t())


# ---------------------------------------------------------------------------
# [F4] Unowned pincode falls back to home
# ---------------------------------------------------------------------------

def test_unowned_pincode_routes_to_home():
    async def _t():
        async with AsyncSessionLocal() as db:
            principal, cid, home_id = await _setup(db)
            # 400001 is not seeded to any non-home franchisee
            owner = await franchisee_for_pincode(db, cid, _PIN["F4"])
            assert owner == home_id
    run(_t())


# ---------------------------------------------------------------------------
# [F5] Dry-run does NOT write franchisee_pincodes rows
# ---------------------------------------------------------------------------

def test_dry_run_does_not_write():
    async def _t():
        async with AsyncSessionLocal() as db:
            principal, cid, home_id = await _setup(db)
            out = await svc.create_franchisee(db, principal, _ext_req("F5DRYRUN"))
            fid = out.id

        async with AsyncSessionLocal() as db:
            principal, cid, home_id = await _setup(db)
            before = (
                await db.execute(
                    text("SELECT COUNT(*) FROM franchisee_pincodes WHERE franchisee_id = :fid"),
                    {"fid": str(fid)},
                )
            ).scalar()

            change = await svc.set_pincodes(
                db, principal, fid,
                PincodesRequest(pincodeRanges=_PIN["F5"]),
                dry_run=True,
            )

            after = (
                await db.execute(
                    text("SELECT COUNT(*) FROM franchisee_pincodes WHERE franchisee_id = :fid"),
                    {"fid": str(fid)},
                )
            ).scalar()

        assert change.dryRun is True
        assert change.resolvedCount > 0, "Expected pincodes in 400002-400006 to resolve"
        assert before == after, "Dry-run must not insert franchisee_pincodes rows"
    run(_t())


# ---------------------------------------------------------------------------
# [F6] Live set_pincodes writes rows
# ---------------------------------------------------------------------------

def test_live_set_pincodes_writes_rows():
    async def _t():
        async with AsyncSessionLocal() as db:
            principal, cid, home_id = await _setup(db)
            out = await svc.create_franchisee(db, principal, _ext_req("F6LIVE"))
            fid = out.id

        async with AsyncSessionLocal() as db:
            principal, cid, home_id = await _setup(db)
            change = await svc.set_pincodes(
                db, principal, fid,
                PincodesRequest(pincodeRanges=_PIN["F6"]),
                dry_run=False,
            )

        assert change.dryRun is False
        assert change.resolvedCount > 0
        assert change.added.count == change.resolvedCount
        assert change.clashCount == 0

        async with AsyncSessionLocal() as db:
            stored = (
                await db.execute(
                    text("SELECT COUNT(*) FROM franchisee_pincodes WHERE franchisee_id = :fid"),
                    {"fid": str(fid)},
                )
            ).scalar()
        assert stored == change.resolvedCount
    run(_t())


# ---------------------------------------------------------------------------
# Routing: after set_pincodes, franchisee_for_pincode returns the owner
# ---------------------------------------------------------------------------

def test_routing_returns_owner_after_set():
    async def _t():
        async with AsyncSessionLocal() as db:
            principal, cid, home_id = await _setup(db)
            out = await svc.create_franchisee(db, principal, _ext_req("ROUTE"))
            fid = out.id

        async with AsyncSessionLocal() as db:
            principal, cid, home_id = await _setup(db)
            await svc.set_pincodes(
                db, principal, fid,
                PincodesRequest(pincodeRanges=_PIN["ROUTE"]),
                dry_run=False,
            )

        async with AsyncSessionLocal() as db:
            principal, cid, home_id = await _setup(db)
            owner = await franchisee_for_pincode(db, cid, _PIN["ROUTE"])

        assert owner == fid
    run(_t())


# ---------------------------------------------------------------------------
# [F3a] Pincode overlap on live apply -> 409 PINCODE_CLASH
# ---------------------------------------------------------------------------

def test_clash_rejected_on_live_apply():
    from fastapi import HTTPException

    async def _t():
        async with AsyncSessionLocal() as db:
            principal, cid, home_id = await _setup(db)
            a = await svc.create_franchisee(db, principal, _ext_req("F3A_A"))
            b = await svc.create_franchisee(db, principal, _ext_req("F3A_B"))

        async with AsyncSessionLocal() as db:
            principal, cid, home_id = await _setup(db)
            await svc.set_pincodes(
                db, principal, a.id,
                PincodesRequest(pincodeRanges=_PIN["F3a_A"]),
                dry_run=False,
            )

        async with AsyncSessionLocal() as db:
            principal, cid, home_id = await _setup(db)
            with pytest.raises((HTTPException, Exception)) as exc:
                await svc.set_pincodes(
                    db, principal, b.id,
                    PincodesRequest(pincodeRanges=_PIN["F3a_B"]),
                    dry_run=False,
                )
            assert exc.value.status_code == 409
            assert exc.value.code == "FRANCHISEE_PINCODE_TAKEN"
    run(_t())


# ---------------------------------------------------------------------------
# [F3b] Dry-run on overlap shows clashes without raising
# ---------------------------------------------------------------------------

def test_clash_shown_in_dry_run():
    async def _t():
        async with AsyncSessionLocal() as db:
            principal, cid, home_id = await _setup(db)
            a = await svc.create_franchisee(db, principal, _ext_req("F3B_A"))
            b = await svc.create_franchisee(db, principal, _ext_req("F3B_B"))

        async with AsyncSessionLocal() as db:
            principal, cid, home_id = await _setup(db)
            await svc.set_pincodes(
                db, principal, a.id,
                PincodesRequest(pincodeRanges=_PIN["F3b_A"]),
                dry_run=False,
            )

        async with AsyncSessionLocal() as db:
            principal, cid, home_id = await _setup(db)
            change = await svc.set_pincodes(
                db, principal, b.id,
                PincodesRequest(pincodeRanges=_PIN["F3b_B"]),
                dry_run=True,
            )

        assert change.dryRun is True
        assert change.clashCount > 0
        assert len(change.clashes) > 0
    run(_t())


# ---------------------------------------------------------------------------
# [F7] Home franchisee pincodes are immutable
# ---------------------------------------------------------------------------

def test_home_pincodes_immutable():
    from app.core.errors import AppError

    async def _t():
        async with AsyncSessionLocal() as db:
            principal, cid, home_id = await _setup(db)
            with pytest.raises(AppError) as exc:
                await svc.set_pincodes(
                    db, principal, home_id,
                    PincodesRequest(pincodeRanges=_PIN["F7"]),
                    dry_run=False,
                )
            assert exc.value.status_code == 409
            assert exc.value.code == "FRANCHISEE_HOME_IMMUTABLE"
    run(_t())


# ---------------------------------------------------------------------------
# [F8] Inactive franchisee cannot receive pincodes
# ---------------------------------------------------------------------------

def test_inactive_franchisee_cannot_receive_pincodes():
    from fastapi import HTTPException

    async def _t():
        async with AsyncSessionLocal() as db:
            principal, cid, home_id = await _setup(db)
            out = await svc.create_franchisee(db, principal, _ext_req("F8INACTIVE"))
            fid = out.id

        async with AsyncSessionLocal() as db:
            principal, cid, home_id = await _setup(db)
            await svc.deactivate(db, principal, fid)

        async with AsyncSessionLocal() as db:
            principal, cid, home_id = await _setup(db)
            with pytest.raises(HTTPException) as exc:
                await svc.set_pincodes(
                    db, principal, fid,
                    PincodesRequest(pincodeRanges=_PIN["F8"]),
                    dry_run=False,
                )
            assert exc.value.status_code == 409
    run(_t())


# ---------------------------------------------------------------------------
# [R3] Last active admin cannot be deactivated
# ---------------------------------------------------------------------------

def test_last_admin_block():
    from fastapi import HTTPException

    async def _t():
        async with AsyncSessionLocal() as db:
            principal, cid, home_id = await _setup(db)
            tag = uuid.uuid4().hex[:8]
            req = FranchiseeCreateRequest(
                name=f"IntTest R3 {tag}",
                kind="external",
                contactName="R3 Contact",
                contactPhone="+919000000099",
                admin=FranchiseeAdminIn(
                    fullName="Sole Admin",
                    email=f"soleadmin.{tag}@inttest.io",
                    phone="+919100000001",
                ),
            )
            out = await svc.create_franchisee(db, principal, req)
            fid = out.id
            mid = out.admin.membershipId  # type: ignore[union-attr]

        async with AsyncSessionLocal() as db:
            principal, cid, home_id = await _setup(db)
            with pytest.raises(HTTPException) as exc:
                await svc.set_admin_active(db, principal, fid, mid, active=False)
            assert exc.value.status_code == 409
            assert exc.value.code == "FRANCHISEE_LAST_ADMIN"
    run(_t())


# ---------------------------------------------------------------------------
# [T1] Guessed franchisee id -> 404
# ---------------------------------------------------------------------------

def test_guessed_id_returns_404():
    from fastapi import HTTPException

    async def _t():
        async with AsyncSessionLocal() as db:
            principal, cid, home_id = await _setup(db)
            with pytest.raises(HTTPException) as exc:
                await svc.get_franchisee(db, principal, uuid.uuid4())
            assert exc.value.status_code == 404
    run(_t())


# ---------------------------------------------------------------------------
# [T2] List is scoped to the calling company
# ---------------------------------------------------------------------------

def test_list_scoped_to_company():
    async def _t():
        async with AsyncSessionLocal() as db:
            principal, cid, home_id = await _setup(db)
            rows, total = await svc.list_franchisees(
                db, principal, ListParams(), kind=None, status_filter=None
            )
            assert total >= 1
            assert len([r for r in rows if r.isHome]) == 1
    run(_t())


# ---------------------------------------------------------------------------
# [T3] activate/deactivate with unknown id -> 404
# ---------------------------------------------------------------------------

def test_activate_unknown_id_returns_404():
    from fastapi import HTTPException

    async def _t():
        async with AsyncSessionLocal() as db:
            principal, cid, home_id = await _setup(db)
            with pytest.raises(HTTPException) as exc:
                await svc.activate(db, principal, uuid.uuid4())
            assert exc.value.status_code == 404
    run(_t())


def test_deactivate_unknown_id_returns_404():
    from fastapi import HTTPException

    async def _t():
        async with AsyncSessionLocal() as db:
            principal, cid, home_id = await _setup(db)
            with pytest.raises(HTTPException) as exc:
                await svc.deactivate(db, principal, uuid.uuid4())
            assert exc.value.status_code == 404
    run(_t())


# ---------------------------------------------------------------------------
# [F2] Bad range grammar -> 422
# ---------------------------------------------------------------------------

def test_bad_range_grammar_returns_422():
    from fastapi import HTTPException

    async def _t():
        async with AsyncSessionLocal() as db:
            principal, cid, home_id = await _setup(db)
            out = await svc.create_franchisee(db, principal, _ext_req("F2GRAMMAR"))

        async with AsyncSessionLocal() as db:
            principal, cid, home_id = await _setup(db)
            with pytest.raises(HTTPException) as exc:
                await svc.set_pincodes(
                    db, principal, out.id,
                    PincodesRequest(pincodeRanges="not-a-pincode!!!"),
                    dry_run=False,
                )
            assert exc.value.status_code == 422
    run(_t())


# ---------------------------------------------------------------------------
# [C1] Empty ranges clears all pincodes back to home
# ---------------------------------------------------------------------------

def test_empty_ranges_clears_pincodes():
    async def _t():
        async with AsyncSessionLocal() as db:
            principal, cid, home_id = await _setup(db)
            out = await svc.create_franchisee(db, principal, _ext_req("C1CLEAR"))
            fid = out.id

        async with AsyncSessionLocal() as db:
            principal, cid, home_id = await _setup(db)
            await svc.set_pincodes(
                db, principal, fid,
                PincodesRequest(pincodeRanges=_PIN["CLEAR"]),
                dry_run=False,
            )

        async with AsyncSessionLocal() as db:
            principal, cid, home_id = await _setup(db)
            change = await svc.set_pincodes(
                db, principal, fid,
                PincodesRequest(pincodeRanges=""),
                dry_run=False,
            )

        assert change.removed.count > 0

        async with AsyncSessionLocal() as db:
            stored = (
                await db.execute(
                    text("SELECT COUNT(*) FROM franchisee_pincodes WHERE franchisee_id = :fid"),
                    {"fid": str(fid)},
                )
            ).scalar()
        assert stored == 0
    run(_t())
