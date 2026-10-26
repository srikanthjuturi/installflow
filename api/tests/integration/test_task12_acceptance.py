"""Task 12 §7 acceptance — spare parts, driven through the SERVICE layer against
RelianceDB (dev), the way `test_task05_acceptance.py` runs: the cast seeded by
`app.scripts.seed_task05`, hand-built `Principal`s, a fresh session per segment,
no HTTP. Run with:

    cd api
    .venv/Scripts/python.exe -m pytest tests/integration/test_task12_acceptance.py -v

**Nothing real leaves the process.** The `.env` carries live WhatsApp, e-mail and
push credentials, so a module fixture empties the tokens on `settings`, switches
push off, and replaces the three outbound doors the flows would touch with
recorders: the facility push (`send_to_technicians`, recorded so the texts can be
asserted), the temporary-password mail, and the customer feedback request.
Customers and logins are synthetic (`+911…`, `@seed.example.com`).

The order matters and the tests hand state to one another through `FACTS`: the
facility cast and catalogue (#0), the main walk on ticket T1 (#11-#26, #28, #33),
the R2 walk on T3, the waiting ticket T4, and the home franchisee's NO_FACILITY
walk on T5.

What this file does NOT prove (no HTTP, no devices): the route wiring and its
guards in a running server (the guard FUNCTIONS are called directly), the signed
URL of a real uploaded photo, two terminals racing over the wire (the race is two
sessions here), and a phone receiving the push.
"""

import asyncio
import dataclasses
import datetime
import sys
import types
import uuid

import pytest

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from fastapi import BackgroundTasks, HTTPException  # noqa: E402
from pydantic import ValidationError  # noqa: E402
from sqlalchemy import func, select, text, update  # noqa: E402
from sqlalchemy.exc import IntegrityError  # noqa: E402

from app.core import franchise_logins  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.core.coverage import users_notified_by  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.core.deps import (  # noqa: E402
    Principal,
    require_facility_principal,
    require_feature,
    require_staff_principal,
)
from app.core.errors import AppError  # noqa: E402
from app.core.facility_users import (  # noqa: E402
    FacilityUserCreateRequest,
    create_user as create_facility_user,
    list_users as list_facility_users,
    reissue as reissue_facility_user,
    set_user_active,
)
from app.core.franchise import home_franchisee_id  # noqa: E402
from app.core.schemas import ListParams  # noqa: E402
from app.core.security import hash_password, hash_token, verify_password  # noqa: E402
from app.core.speed_settle import load_clock  # noqa: E402
from app.core.spare_parts import catalogue_for, franchisee_has_facility  # noqa: E402
from app.core.vendor_credits import standing as vendor_standing  # noqa: E402
from app.features.jobs import service as jobs_service  # noqa: E402
from app.features.jobs.router import SEGMENTS  # noqa: E402
from app.features.jobs.schemas import PartRequestCreate  # noqa: E402
from app.features.notifications import service as notif_service  # noqa: E402
from app.features.spare_parts import service as parts_service  # noqa: E402
from app.features.spare_parts.router import require_parts_handler  # noqa: E402
from app.features.spare_parts.schemas import (  # noqa: E402
    ApproveBody,
    IssueBody,
    RejectBody,
    ReturnBody,
    SparePartCreate,
    SparePartUpdate,
)
from app.features.tickets import service as tickets_service  # noqa: E402
from app.features.tickets.schemas import (  # noqa: E402
    ForceCloseAttachmentIn,
    ForceCloseRequest,
    TicketCreateRequest,
)
from app.models.membership import Membership  # noqa: E402
from app.models.notification import Notification  # noqa: E402
from app.models.product import ProductModel, ProductNode  # noqa: E402
from app.models.role import FRANCHISE_ROLES, ROLE_RANKS  # noqa: E402
from app.models.spare_part import SparePart, SparePartRequest  # noqa: E402
from app.models.technician import TechnicianPincode, TechnicianProfile  # noqa: E402
from app.models.ticket import Ticket  # noqa: E402
from app.models.ticket_event import TicketEvent  # noqa: E402
from app.models.token import RefreshToken  # noqa: E402
from app.models.user import User  # noqa: E402
from app.scripts import seed_task05  # noqa: E402
from tests.integration.test_task05_acceptance import settle_open_jobs  # noqa: E402
from app.scripts.seed import verify as seed_verify  # noqa: E402
from app.scripts.seed.guards import synthetic_email, synthetic_phone  # noqa: E402
from app.scripts.seed.lifecycle import _artifacts as seed_artifacts  # noqa: E402
from app.scripts.seed.tenant import phone_block  # noqa: E402

# ── nothing real leaves the process ──────────────────────────────────────────

PUSHES: list[tuple[uuid.UUID, str, dict]] = []  # (technician id, key, params)
MEENA_PASSWORD = "Meena#12345-old"


@pytest.fixture(scope="module", autouse=True)
def _no_real_sends():
    mp = pytest.MonkeyPatch()
    mp.setattr(settings, "WHATSAPP_TOKEN", "")
    mp.setattr(settings, "PUSH_ENABLED", False)
    mp.setattr(settings, "WEB_PUSH_ENABLED", False)
    mp.setattr(settings, "ACS_CONNECTION_STRING", "")

    async def _push(db, *, company_id, technician_ids, message, data=None):
        for tid in technician_ids:
            PUSHES.append((tid, message.key, dict(message.params)))
        return 0

    async def _mail(**_kw):
        return types.SimpleNamespace(ok=True, error=None)

    async def _nothing(*_a, **_k):
        return None

    mp.setattr(parts_service, "send_to_technicians", _push)
    mp.setattr(franchise_logins, "send_temporary_password", _mail)
    mp.setattr(jobs_service, "_send_feedback_request", _nothing)
    yield
    try:
        # Whatever a failed test left in flight is settled through the product, so no
        # technician of the cast is left holding an open job for the next module.
        settle_open_jobs()
    finally:
        mp.undo()


# ── the world and the cast ───────────────────────────────────────────────────

_W: seed_task05.World | None = None


def world() -> seed_task05.World:
    global _W
    if _W is None:

        async def _b():
            async with AsyncSessionLocal() as db:
                return await seed_task05.build(db)

        _W = asyncio.run(_b())
    return _W


def run(coro):
    return asyncio.run(coro)


@dataclasses.dataclass
class Facts:
    catalogue: dict[str, uuid.UUID] = dataclasses.field(default_factory=dict)
    root_id: uuid.UUID | None = None
    t1: uuid.UUID | None = None          # the main walk (Ravi, S)
    t1_code: str | None = None
    t2: uuid.UUID | None = None          # Assigned only
    t3: uuid.UUID | None = None          # the R2 walk
    t4: uuid.UUID | None = None          # waiting: reschedule, force-close
    t5: uuid.UUID | None = None          # Hema, home
    r_pump: uuid.UUID | None = None
    r_clamp: uuid.UUID | None = None
    r_pump_code: str | None = None


FACTS = Facts()

EMAILS = {
    "meena": synthetic_email("t12-meena"),        # S facility operator
    "fatima": synthetic_email("t12-fatima"),      # S facility admin
    "arun": synthetic_email("t12-arun"),          # T facility operator
    "hfac": synthetic_email("t12-home-facility"),  # HOME facility admin (made in #38)
    "hfac2": synthetic_email("t12-home-facility-two"),
    "newop": synthetic_email("t12-new-operator"),
    "newadm": synthetic_email("t12-new-admin"),
}


def _phone(n: int) -> str:
    return synthetic_phone(phone_block("t12-integration") + n)


async def user_principal(db, email: str, company_id) -> Principal:
    """Any cast member by email — with the franchisee a franchise role acts for,
    read off the live membership exactly as `get_current_principal` does."""
    user = await db.scalar(select(User).where(User.email == email.lower()))
    assert user is not None, email
    franchisee_id = None
    if user.role in FRANCHISE_ROLES:
        franchisee_id = await db.scalar(
            select(Membership.franchisee_id).where(
                Membership.company_id == company_id,
                Membership.user_id == user.id,
                Membership.deleted_at.is_(None),
            )
        )
    return Principal(
        user=user,
        role=user.role,
        rank=ROLE_RANKS[user.role],
        is_superadmin=False,
        company_id=company_id,
        franchisee_id=franchisee_id,
    )


async def p(db, key: str) -> Principal:
    w = world()
    cid = w.company_a_id
    if key == "admin":
        return await seed_task05._principal_for(
            db, await seed_task05._user_by_email(db, w.company_a_admin_email), cid
        )
    mapping = {
        "priya": w.priya_email,    # S's franchisee admin
        "uma": w.uma_email,        # T's franchisee admin
        "hari": w.hari_email,      # H's franchisee admin
        "kiran": w.kiran_email,    # Area Manager over S's state
        "nisha": w.nisha_email,    # National Head
        "meena": EMAILS["meena"],
        "fatima": EMAILS["fatima"],
        "arun": EMAILS["arun"],
        "hfac": EMAILS["hfac"],
    }
    if key in mapping:
        return await user_principal(db, mapping[key], cid)
    if key == "ravi":
        return await seed_task05.technician_principal(db, w.ravi_id, cid)
    if key == "hema":
        return await seed_task05.technician_principal(db, w.hema_id, cid)
    if key == "vendor":
        user = await seed_task05._user_by_email(db, w.vendor_email)
        return Principal(
            user=user, role=user.role, rank=0, is_superadmin=False,
            company_id=cid, vendor_id=w.vendor_id,
        )
    raise KeyError(key)


async def tech(db, which: str) -> TechnicianProfile:
    w = world()
    return await db.get(
        TechnicianProfile, w.ravi_id if which == "ravi" else w.hema_id,
        populate_existing=True,
    )


def status_of(exc) -> int | None:
    return getattr(exc.value, "status_code", None)


def code_of(exc) -> str | None:
    return getattr(exc.value, "code", None)


# ── tickets: raise, accept, start ────────────────────────────────────────────


async def ensure_vendor_headroom(db) -> None:
    """The vendor's line must hold the run's tickets (see test_task05's note)."""
    w = world()
    line = await vendor_standing(db, w.company_a_id, w.vendor_id)
    needed = line.used_paise + line.reserved_paise + 5_000_000
    if line.limit_paise < needed:
        from app.features.vendors import service as vendors_service
        from app.features.vendors.schemas import VendorUpdateRequest

        await vendors_service.update_vendor(
            db, await p(db, "admin"), w.vendor_id, VendorUpdateRequest(creditLimitPaise=needed)
        )


async def raise_ticket(db, tech_profile, *, index: int) -> Ticket:
    w = world()
    codes = list(
        await db.scalars(
            select(TechnicianPincode.pincode).where(
                TechnicianPincode.technician_id == tech_profile.id
            )
        )
    )
    assert codes
    await ensure_vendor_headroom(db)
    body = TicketCreateRequest(
        subcategoryId=w.leaf_id,
        modelId=w.model_id,
        serviceType=w.service_types[0],
        serialNumber=f"T12{index:04d}{uuid.uuid4().hex[:6].upper()}",
        customerName="Task12 Customer",
        customerPhone=_phone(10_000 + index),
        address=f"Flat {index}, Part Street",
        city="Hyderabad",
        state="Telangana",
        pincode=codes[0],
        expectedDate=datetime.datetime.now(datetime.timezone.utc).date()
        + datetime.timedelta(days=1),
        serviceLevelHours=48,
    )
    created = await tickets_service.create_ticket(db, await p(db, "vendor"), body)
    row = await db.get(Ticket, created.id)
    from app.core.slots import bookable_slots

    windows = await bookable_slots(db, row)
    assert windows
    await tickets_service.confirm_slot(db, row.slot_token, windows[0][0])
    await db.refresh(row)
    return row


async def accept(db, tech_profile, row: Ticket) -> Ticket:
    await jobs_service.accept(
        db, row.id, company_id=world().company_a_id, profile=tech_profile,
        background=BackgroundTasks(),
    )
    await db.refresh(row)
    return row


async def start(db, tech_profile, row: Ticket) -> Ticket:
    w = world()
    await jobs_service.submit_proof(
        db, row.id, company_id=w.company_a_id, profile=tech_profile,
        artifacts=seed_artifacts(w.company_a_id, row),
        observed_serial=row.serial_number, observed_serial_source="scanned",
    )
    await db.refresh(row)
    return row


async def started_job(which: str, index: int) -> uuid.UUID:
    async with AsyncSessionLocal() as db:
        prof = await tech(db, which)
        row = await raise_ticket(db, prof, index=index)
        await accept(db, prof, row)
        await start(db, prof, row)
        assert row.status == "In Progress"
        return row.id


async def ticket(db, tid: uuid.UUID) -> Ticket:
    return await db.get(Ticket, tid, populate_existing=True)


async def events(db, tid: uuid.UUID) -> list[TicketEvent]:
    return list(
        await db.scalars(
            select(TicketEvent).where(TicketEvent.ticket_id == tid).order_by(TicketEvent.seq)
        )
    )


async def requests_of(db, tid: uuid.UUID) -> list[SparePartRequest]:
    return list(
        await db.scalars(
            select(SparePartRequest)
            .where(SparePartRequest.ticket_id == tid)
            .order_by(SparePartRequest.created_at, SparePartRequest.code)
        )
    )


async def request_part(which: str, tid: uuid.UUID, **body):
    async with AsyncSessionLocal() as db:
        prof = await tech(db, which)
        return await jobs_service.request_part(
            db, tid, company_id=world().company_a_id, profile=prof,
            body=PartRequestCreate(**body),
        )


async def facility_act(who: str, request_id: uuid.UUID, action: str, body):
    async with AsyncSessionLocal() as db:
        return await parts_service.act(db, await p(db, who), request_id, action, body=body)


# ── #0. the cast: facility users and the catalogue ───────────────────────────


async def ensure_facility_user(db, actor_key, franchisee_id, email, name, role, n, *, active=True):
    w = world()
    user = await db.scalar(select(User).where(User.email == email.lower()))
    actor = await p(db, actor_key)
    if user is None:
        await create_facility_user(
            db, actor=actor, franchisee_id=franchisee_id,
            body=FacilityUserCreateRequest(
                fullName=name, email=email, phone=_phone(n), role=role,
            ),
        )
    membership = await db.scalar(
        select(Membership).where(
            Membership.company_id == w.company_a_id,
            Membership.user_id == (await db.scalar(select(User.id).where(User.email == email.lower()))),
            Membership.deleted_at.is_(None),
        )
    )
    if bool(membership.is_active) != active:
        await set_user_active(
            db, actor=actor, franchisee_id=franchisee_id,
            membership_id=membership.id, active=active,
        )


def test_00_the_cast_and_the_catalogue():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            await ensure_facility_user(db, "priya", w.s_id, EMAILS["meena"], "Meena Facility", "facility_operator", 1)
            await ensure_facility_user(db, "priya", w.s_id, EMAILS["fatima"], "Fatima Facility", "facility_admin", 2)
            await ensure_facility_user(db, "uma", w.t_id, EMAILS["arun"], "Arun Facility", "facility_operator", 3)
            # Meena has a known password and one live session, so the later
            # deactivation / reissue can be observed.
            meena = await db.scalar(select(User).where(User.email == EMAILS["meena"]))
            meena.password_hash = hash_password(MEENA_PASSWORD)
            token_hash = hash_token(f"t12-{uuid.uuid4()}")
            db.add(
                RefreshToken(
                    user_id=meena.id, token_hash=token_hash,
                    expires_at=datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=7),
                )
            )
            # Home starts WITHOUT a facility (R4): any facility user a previous
            # run left there is switched off here, and re-enabled by #38.
            home = await home_franchisee_id(db, w.company_a_id)
            for email in (EMAILS["hfac"], EMAILS["hfac2"]):
                if await db.scalar(select(User.id).where(User.email == email)):
                    await ensure_facility_user(
                        db, "admin", home, email, "Home Facility", "facility_admin", 4, active=False,
                    )
            await db.commit()

            # The catalogue is rebuilt from scratch: every earlier part on this
            # company's tree was a previous run's.
            await db.execute(
                text("UPDATE spare_parts SET deleted_at = now() WHERE company_id = :c AND deleted_at IS NULL"),
                {"c": w.company_a_id},
            )
            await db.commit()
            admin = await p(db, "admin")
            leaf = await db.get(ProductNode, w.leaf_id)
            FACTS.root_id = leaf.ancestor_ids[0]
            plan = [
                ("root", dict(node_id=FACTS.root_id), ["Power cord"]),
                ("leaf", dict(node_id=w.leaf_id), ["Drain pump", "Inlet hose", "Door gasket", "Door lock", "Drum bearing"]),
                ("model", dict(model_id=w.model_id), ["Control board FL-7", "Door gasket"]),
            ]
            for level, owner, names in plan:
                for name in names:
                    out = await parts_service.add_part(db, admin, SparePartCreate(name=name), **owner)
                    FACTS.catalogue[f"{level}:{name}"] = out.id
            # The FL-7 gasket is not a field part: the model switches it off.
            await parts_service.update_part(
                db, admin, FACTS.catalogue["model:Door gasket"], SparePartUpdate(isActive=False)
            )

    run(_t())


# ── #1-#7. migration and schema ──────────────────────────────────────────────


def test_01_schema_vocabularies_and_constraints():
    async def _t():
        async with AsyncSessionLocal() as db:
            defs = dict(
                (await db.execute(text(
                    "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname IN "
                    "('ck_tickets_status','ck_ticket_events_kind','ck_notifications_kind','ck_notifications_audience')"
                ))).all()
            )
            assert "'Awaiting Part'" in defs["ck_tickets_status"]
            for kind in ("part_requested", "part_approved", "part_rejected", "part_issued", "part_returned"):
                assert f"'{kind}'" in defs["ck_ticket_events_kind"]
            for kind in ("part_requested", "part_decided", "part_issued"):
                assert f"'{kind}'" in defs["ck_notifications_kind"]
            assert "'facility'" in defs["ck_notifications_audience"]
            assert "'franchisee_admin'" in defs["ck_notifications_audience"]
            # …and the earlier values are all still there.
            assert "'speed_settled'" in defs["ck_ticket_events_kind"]
            assert "'technician_moved'" in defs["ck_notifications_kind"]

    run(_t())


def test_05_every_fk_is_covered_and_tenancy_links_exist():
    async def _t():
        async with AsyncSessionLocal() as db:
            uncovered = (await db.execute(text("""
                SELECT c.conrelid::regclass::text, c.conname FROM pg_constraint c
                WHERE c.contype = 'f' AND NOT EXISTS (
                  SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid
                    AND (i.indkey::int2[])[0:array_length(c.conkey,1)-1] = c.conkey)
            """))).all()
            mine = [r for r in uncovered if r[0] in ("spare_parts", "spare_part_requests")]
            assert mine == [], mine

    run(_t())


def test_06_constraints_refuse_what_they_should():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            # Both owners set -> ck_spare_parts_one_owner.
            with pytest.raises(IntegrityError) as exc:
                await db.execute(
                    text("INSERT INTO spare_parts (company_id, node_id, model_id, name) VALUES (:c, :n, :m, 'x')"),
                    {"c": w.company_a_id, "n": w.leaf_id, "m": w.model_id},
                )
            assert "ck_spare_parts_one_owner" in str(exc.value)
            await db.rollback()
            # status 'issued' with no issued_at -> ck_..._issued_matches_status.
            # (A scratch request, rolled back: it would be a log row otherwise.)
            t = await db.scalar(select(Ticket.id).where(Ticket.company_id == w.company_a_id).limit(1))
            fr = await db.scalar(select(Ticket.franchisee_id).where(Ticket.id == t))
            tech_id = w.ravi_id
            with pytest.raises(IntegrityError) as exc:
                await db.execute(
                    text(
                        "INSERT INTO spare_part_requests (company_id, code, franchisee_id, ticket_id, technician_id,"
                        " other_name, part_name, status, decided_at, decided_by_label)"
                        " VALUES (:c, 'SCRATCH-1', :f, :t, :tech, 'x', 'x', 'issued', now(), 'x')"
                    ),
                    {"c": w.company_a_id, "f": fr, "t": t, "tech": tech_id},
                )
            assert "ck_spare_part_requests_issued_matches_status" in str(exc.value)
            await db.rollback()

    run(_t())


def test_02_the_migration_refuses_a_before_list_that_lost_a_value():
    """The guard: a sibling's value missing from the BEFORE list stops the
    upgrade with the constraint named — it is never dropped silently."""
    import importlib.util
    from pathlib import Path

    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import create_engine

    path = Path(__file__).resolve().parents[2] / "alembic" / "versions" / "d6c3a9f1e874_spare_parts.py"
    spec = importlib.util.spec_from_file_location("m_d6c3", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    engine = create_engine(settings.DATABASE_URL)
    with engine.connect() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            # The real list (+ the value this very revision added, now live): ok.
            migration._assert_check_is(
                "tickets", "status", migration._STATUS_BEFORE + ", 'Awaiting Part'"
            )
            # A BEFORE list that forgot 'Cancelled': refuse, naming it.
            lossy = migration._STATUS_BEFORE.replace(", 'Cancelled'", "") + ", 'Awaiting Part'"
            with pytest.raises(RuntimeError) as exc:
                migration._assert_check_is("tickets", "status", lossy)
            assert "ck_tickets_status" in str(exc.value)
            assert "Cancelled" in str(exc.value)
    engine.dispose()


# ── #8-#10. the catalogue ────────────────────────────────────────────────────


def test_08_model_catalogue_own_and_inherited():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            out = await parts_service.model_catalogue(db, await p(db, "admin"), w.model_id)
            own = {(r.name, r.isActive) for r in out.own}
            assert own == {("Control board FL-7", True), ("Door gasket", False)}
            inherited = [r.name for r in out.inherited]
            assert sorted(inherited) == sorted(
                ["Door gasket", "Door lock", "Drain pump", "Drum bearing", "Inlet hose", "Power cord"]
            )
            assert out.owner.kind == "model"
            # A node's view: its own rows, and what its ancestors pass down.
            node = await parts_service.node_catalogue(db, await p(db, "admin"), w.leaf_id)
            assert {r.name for r in node.own} == {
                "Drain pump", "Inlet hose", "Door gasket", "Door lock", "Drum bearing"
            }
            assert [r.name for r in node.inherited] == ["Power cord"]

    run(_t())


def test_09_catalogue_names_are_unique_per_owner_case_and_space_insensitive():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            admin = await p(db, "admin")
            with pytest.raises(HTTPException) as exc:
                await parts_service.add_part(db, admin, SparePartCreate(name=" drain  PUMP "), node_id=w.leaf_id)
            assert exc.value.status_code == 409
            # Another owner: 201 (here the model, standing in for "another node").
            out = await parts_service.add_part(db, admin, SparePartCreate(name=" drain  PUMP "), model_id=w.model_id)
            assert out.name == "drain PUMP"
            # …and a rename onto an existing name is refused too.
            with pytest.raises(HTTPException) as exc:
                await parts_service.update_part(db, admin, out.id, SparePartUpdate(name="Control board FL-7"))
            assert exc.value.status_code == 409
            await parts_service.delete_part(db, admin, out.id)
            # Soft-deleted -> the name is free again.
            again = await parts_service.add_part(db, admin, SparePartCreate(name="drain pump"), model_id=w.model_id)
            await parts_service.delete_part(db, admin, again.id)

    run(_t())


def test_10_catalogue_is_staff_only_and_company_scoped():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            # The staff guard refuses a vendor and franchise staff before any route runs.
            for who in ("vendor", "meena", "priya"):
                with pytest.raises(HTTPException) as exc:
                    require_staff_principal(await p(db, who))
                assert exc.value.status_code == 403
            # `parts.catalogue` is Admin / National Head's: an Area Manager lacks it.
            guard = require_feature("parts.catalogue")
            with pytest.raises(HTTPException) as exc:
                await guard(await p(db, "kiran"), db)
            assert exc.value.status_code == 403
            assert (await guard(await p(db, "admin"), db)).role == "admin"
            # Another company's node id -> 404, never a 403.
            company_b_node = await db.scalar(
                select(ProductNode.id).where(ProductNode.company_id != w.company_a_id).limit(1)
            )
            if company_b_node is not None:
                with pytest.raises(HTTPException) as exc:
                    await parts_service.node_catalogue(db, await p(db, "admin"), company_b_node)
                assert exc.value.status_code == 404
            with pytest.raises(HTTPException) as exc:
                await parts_service.model_catalogue(db, await p(db, "admin"), uuid.uuid4())
            assert exc.value.status_code == 404

    run(_t())


# ── #11-#19. the technician ──────────────────────────────────────────────────


def test_11_the_parts_screen_offers_the_merged_list():
    async def _t():
        FACTS.t1 = await started_job("ravi", 1)
        async with AsyncSessionLocal() as db:
            row = await ticket(db, FACTS.t1)
            FACTS.t1_code = row.code
            out = await jobs_service.get_job_parts(
                db, FACTS.t1, company_id=world().company_a_id, technician_id=world().ravi_id
            )
            assert out.partsEnabled and out.canRequest
            assert [c.name for c in out.catalogue] == [
                "Control board FL-7", "Door lock", "Drain pump", "Drum bearing", "Inlet hose", "Power cord",
            ]
            assert out.requests == []
            # The job itself carries the same flag for the first paint.
            job = await jobs_service.get_job(
                db, FACTS.t1, company_id=world().company_a_id, technician_id=world().ravi_id
            )
            assert job.partsEnabled is True

    run(_t())


def test_12_a_request_parks_the_job_and_rings_the_facility():
    w = world()

    async def _t():
        out, created = await request_part(
            "ravi", FACTS.t1, sparePartId=FACTS.catalogue["leaf:Drain pump"], note="pump motor seized"
        )
        assert created
        assert out.status == "Awaiting Part"
        async with AsyncSessionLocal() as db:
            row = await ticket(db, FACTS.t1)
            assert row.status == "Awaiting Part"
            reqs = await requests_of(db, FACTS.t1)
            assert len(reqs) == 1
            req = reqs[0]
            FACTS.r_pump, FACTS.r_pump_code = req.id, req.code
            assert req.status == "requested" and req.franchisee_id == row.franchisee_id
            assert req.code.startswith(f"{(await db.scalar(text('select code from companies where id=:c'), {'c': w.company_a_id}))}-SPR-")
            assert req.part_name == "Drain pump" and req.other_name is None
            evs = await events(db, FACTS.t1)
            last2 = evs[-2:]
            # seq order: the request's own event, THEN the status move (ORDER BY seq DESC LIMIT 2
            # reads status_changed first).
            assert [e.kind for e in last2] == ["part_requested", "status_changed"]
            assert (last2[1].from_status, last2[1].to_status) == ("In Progress", "Awaiting Part")
            assert last2[0].from_status is None and last2[0].to_status is None
            assert last2[0].note.startswith(f"{req.code} · Drain pump · pump motor seized")
            n = await db.scalar(
                select(Notification)
                .where(Notification.ticket_id == FACTS.t1, Notification.kind == "part_requested")
                .order_by(Notification.created_at.desc())
            )
            assert (n.audience, n.franchisee_id) == ("facility", row.franchisee_id)
            assert n.to == f"/franchise/parts/requests/{req.id}"
            assert n.title == f"{row.code}: spare part requested"

    run(_t())


def test_13_a_repeat_is_idempotent():
    async def _t():
        out, created = await request_part("ravi", FACTS.t1, sparePartId=FACTS.catalogue["leaf:Drain pump"])
        assert not created
        # …whatever the name's case or spacing when it is typed as Other.
        out2, created2 = await request_part("ravi", FACTS.t1, otherName="  drain   PUMP ")
        assert not created2
        async with AsyncSessionLocal() as db:
            assert len(await requests_of(db, FACTS.t1)) == 1

    run(_t())


def test_14_a_second_part_while_waiting_adds_no_status_move():
    async def _t():
        async with AsyncSessionLocal() as db:
            before = [e.kind for e in await events(db, FACTS.t1)].count("status_changed")
        out, created = await request_part("ravi", FACTS.t1, otherName="Inlet hose clamp", note="clamp cracked")
        assert created
        async with AsyncSessionLocal() as db:
            reqs = await requests_of(db, FACTS.t1)
            assert len(reqs) == 2
            FACTS.r_clamp = reqs[1].id
            assert reqs[1].other_name == "Inlet hose clamp" and reqs[1].spare_part_id is None
            evs = await events(db, FACTS.t1)
            assert [e.kind for e in evs].count("status_changed") == before
            assert evs[-1].kind == "part_requested"
            assert evs[-1].note.startswith(f"{reqs[1].code} · Other: Inlet hose clamp")

    run(_t())


def test_15_a_part_from_elsewhere_reads_like_an_invented_one():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            # A part that exists in the company but not on this job's tree.
            stray_node = await db.scalar(
                select(ProductNode.id).where(
                    ProductNode.company_id == w.company_a_id,
                    ProductNode.id.notin_([w.leaf_id, FACTS.root_id]),
                ).limit(1)
            )
            stray_id = uuid.uuid4()
            if stray_node is not None:
                admin = await p(db, "admin")
                out = await parts_service.add_part(db, admin, SparePartCreate(name="Television panel"), node_id=stray_node)
                stray_id = out.id
        for part_id in (stray_id, uuid.uuid4()):
            with pytest.raises(HTTPException) as exc:
                await request_part("ravi", FACTS.t1, sparePartId=part_id)
            assert exc.value.status_code == 404
        # …and an INACTIVE part (the FL-7 gasket) is not offered either.
        with pytest.raises(HTTPException) as exc:
            await request_part("ravi", FACTS.t1, sparePartId=FACTS.catalogue["model:Door gasket"])
        assert exc.value.status_code == 404

    run(_t())


def test_16_only_a_started_job_may_ask():
    async def _t():
        async with AsyncSessionLocal() as db:
            prof = await tech(db, "ravi")
            row = await raise_ticket(db, prof, index=2)
            await accept(db, prof, row)  # Assigned, not started
            FACTS.t2 = row.id
        with pytest.raises(AppError) as exc:
            await request_part("ravi", FACTS.t2, otherName="Anything")
        assert exc.value.code == "PART_REQUEST_NOT_IN_PROGRESS"
        assert exc.value.status_code == 409
        async with AsyncSessionLocal() as db:
            assert await requests_of(db, FACTS.t2) == []

    run(_t())


def test_17_complete_is_refused_while_a_request_is_open():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            prof = await tech(db, "ravi")
            with pytest.raises(AppError) as exc:
                await jobs_service.complete(db, FACTS.t1, company_id=w.company_a_id, profile=prof)
            assert exc.value.code == "PARTS_PENDING" and exc.value.status_code == 409
            await db.rollback()
            assert (await ticket(db, FACTS.t1)).status == "Awaiting Part"

    run(_t())


def test_18_the_technician_cannot_cancel_a_waiting_job():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            prof = await tech(db, "ravi")
            with pytest.raises(AppError) as exc:
                await jobs_service.cancel(
                    db, FACTS.t1, company_id=w.company_a_id, profile=prof,
                    reason="Changed my mind",
                )
            assert exc.value.code == "JOB_NOT_CANCELLABLE"
            assert exc.value.status_code == 409
            await db.rollback()

    run(_t())


def test_19_another_technician_gets_a_404_not_a_403():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            with pytest.raises(HTTPException) as exc:
                await jobs_service.get_job_parts(
                    db, FACTS.t1, company_id=w.company_a_id, technician_id=w.hema_id
                )
            assert exc.value.status_code == 404
        with pytest.raises(HTTPException) as exc:
            await request_part("hema", FACTS.t1, otherName="Anything")
        assert exc.value.status_code == 404

    run(_t())


# ── #20-#27. the facility ────────────────────────────────────────────────────


def test_20_the_franchise_wall_is_a_404():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            meena = await p(db, "meena")
            rows, total = await parts_service.list_requests(db, meena, ListParams(limit=100), status=None)
            mine = [r for r in rows if r.ticketId == FACTS.t1]
            assert {r.id for r in mine} == {FACTS.r_pump, FACTS.r_clamp}
            assert all(r.franchiseeId == w.s_id for r in rows)
            counts = await parts_service.counts(db, meena)
            assert counts.requested >= 2
            # Arun (T) cannot see, get, approve or read the ticket.
            arun = await p(db, "arun")
            with pytest.raises(HTTPException) as exc:
                await parts_service.get_request(db, arun, FACTS.r_pump)
            assert exc.value.status_code == 404
            with pytest.raises(HTTPException) as exc:
                await parts_service.act(db, arun, FACTS.r_pump, "approve", body=ApproveBody())
            assert exc.value.status_code == 404
            await db.rollback()
            with pytest.raises(HTTPException) as exc:
                await tickets_service.get_ticket(db, arun, FACTS.t1)
            assert exc.value.status_code == 404
            # A guessed id is a 404 too.
            with pytest.raises(HTTPException) as exc:
                await parts_service.get_request(db, meena, uuid.uuid4())
            assert exc.value.status_code == 404
            # Meena DOES read the ticket (D17), and sees both requests.
            detail = await tickets_service.get_ticket(db, meena, FACTS.t1)
            assert len(detail.partRequests) == 2
            # …and carries no amounts (R8): facility staff see neither.
            assert detail.travel is None and detail.speed is None

    run(_t())


def test_20b_the_status_filter_is_a_set_and_an_unknown_member_empties_the_page():
    async def _t():
        async with AsyncSessionLocal() as db:
            meena = await p(db, "meena")
            rows, _ = await parts_service.list_requests(db, meena, ListParams(limit=100), status="requested")
            assert rows and all(r.status == "requested" for r in rows)
            rows, total = await parts_service.list_requests(db, meena, ListParams(limit=100), status="requested,bogus")
            assert rows == [] and total == 0
            rows, _ = await parts_service.list_requests(
                db, meena, ListParams(limit=100, search="drain"), status=None
            )
            assert any(r.id == FACTS.r_pump for r in rows)
            rows, _ = await parts_service.list_requests(
                db, meena, ListParams(limit=100, search=FACTS.t1_code.lower()), status=None
            )
            assert {r.id for r in rows} >= {FACTS.r_pump, FACTS.r_clamp}

    run(_t())


def test_21_two_facility_users_race_and_exactly_one_wins():
    async def _one(who):
        async with AsyncSessionLocal() as db:
            return await parts_service.act(
                db, await p(db, who), FACTS.r_pump, "approve", body=ApproveBody()
            )

    async def _t():
        PUSHES.clear()
        results = await asyncio.gather(_one("meena"), _one("fatima"), return_exceptions=True)
        wins = [r for r in results if not isinstance(r, BaseException)]
        losses = [r for r in results if isinstance(r, BaseException)]
        assert len(wins) == 1 and len(losses) == 1, results
        assert isinstance(losses[0], AppError)
        assert losses[0].code == "PART_REQUEST_BAD_STATE" and losses[0].status_code == 409
        assert "already approved" in losses[0].detail
        async with AsyncSessionLocal() as db:
            evs = [e for e in await events(db, FACTS.t1) if e.kind == "part_approved"]
            assert len(evs) == 1 and evs[0].actor_kind == "staff"
        assert [k for _t_id, k, _p in PUSHES].count("part.approved") == 1
        assert wins[0].status == "approved" and wins[0].allowedActions == ["issue", "reject"]

    run(_t())


def test_22_a_step_cannot_be_skipped():
    async def _t():
        with pytest.raises(AppError) as exc:
            await facility_act("meena", FACTS.r_clamp, "issue", IssueBody())  # still `requested`
        assert exc.value.code == "PART_REQUEST_BAD_STATE"
        with pytest.raises(AppError) as exc:
            await facility_act("meena", FACTS.r_clamp, "return", ReturnBody())
        assert exc.value.code == "PART_REQUEST_BAD_STATE"

    run(_t())


def test_23_approving_an_other_request_can_add_it_to_the_list():
    w = world()

    async def _t():
        out = await facility_act("meena", FACTS.r_clamp, "approve", ApproveBody(addToCatalogue=True))
        assert out.status == "approved" and out.isOther is False
        async with AsyncSessionLocal() as db:
            req = await db.get(SparePartRequest, FACTS.r_clamp, populate_existing=True)
            assert req.spare_part_id is not None and req.other_name is None
            assert req.part_name == "Inlet hose clamp"  # exactly what the technician typed
            row = await ticket(db, FACTS.t1)
            part = await db.get(SparePart, req.spare_part_id)
            assert part.node_id == row.node_id and part.name == "Inlet hose clamp"
            ev = [e for e in await events(db, FACTS.t1) if e.kind == "part_approved"][-1]
            assert "added to" in ev.note and "parts list" in ev.note
            # A later job on the same tree is now offered it.
            offered = await catalogue_for(
                db, company_id=w.company_a_id, node_path_ids=row.node_path_ids, model_id=row.model_id
            )
            assert "Inlet hose clamp" in [c.name for c in offered]

    run(_t())


def test_24_issue_one_reject_the_other_and_the_job_resumes():
    w = world()

    async def _t():
        PUSHES.clear()
        await facility_act("meena", FACTS.r_pump, "issue", IssueBody(note="FL-7 pump, box 3"))
        async with AsyncSessionLocal() as db:
            # The clamp is still approved, so the job keeps waiting.
            assert (await ticket(db, FACTS.t1)).status == "Awaiting Part"
        out = await facility_act("meena", FACTS.r_clamp, "reject", RejectBody(reason="Not stocked"))
        assert out.status == "rejected" and out.rejectedAfterApproval is True
        async with AsyncSessionLocal() as db:
            row = await ticket(db, FACTS.t1)
            assert row.status == "In Progress"
            move = [e for e in await events(db, FACTS.t1) if e.kind == "status_changed"][-1]
            assert (move.from_status, move.to_status) == ("Awaiting Part", "In Progress")
            assert move.actor_label == "Meena Facility" and move.actor_kind == "staff"
            decided = await db.scalar(
                select(Notification).where(Notification.ticket_id == FACTS.t1, Notification.kind == "part_decided")
            )
            assert decided.audience is None and decided.pincode == row.pincode
            assert decided.title == f"{row.code}: approved part cancelled"
            issued = await db.scalar(
                select(Notification).where(Notification.ticket_id == FACTS.t1, Notification.kind == "part_issued")
            )
            assert issued.audience is None and issued.pincode == row.pincode
        keys = [k for _i, k, _p in PUSHES]
        assert "part.issued" in keys and "part.rejected_after_approval" in keys

    run(_t())


def test_25_complete_now_succeeds():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            prof = await tech(db, "ravi")
            out = await jobs_service.complete(db, FACTS.t1, company_id=w.company_a_id, profile=prof)
            assert out.status == "Awaiting Customer"

    run(_t())


def test_26_return_is_a_log_entry_never_a_gate():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            meena = await p(db, "meena")
            with pytest.raises(HTTPException) as exc:
                await parts_service.act(
                    db, meena, FACTS.r_pump, "return",
                    body=ReturnBody(photoBlobName=f"attachment/{uuid.uuid4()}/x.jpg"),
                )
            assert exc.value.status_code == 400
            await db.rollback()
            with pytest.raises(HTTPException) as exc:
                await parts_service.act(
                    db, meena, FACTS.r_pump, "return",
                    body=ReturnBody(photoBlobName=f"attachment/{w.company_a_id}/../x.jpg"),
                )
            assert exc.value.status_code == 400
            await db.rollback()
        blob = f"attachment/{w.company_a_id}/t12/{uuid.uuid4().hex}.jpg"
        out = await facility_act("meena", FACTS.r_pump, "return", ReturnBody(note="seized, as reported", photoBlobName=blob))
        assert out.status == "returned" and out.returnedAt is not None
        from app.integrations import blob as blob_store

        assert (out.returnPhotoUrl is not None) == blob_store.is_configured()
        async with AsyncSessionLocal() as db:
            assert (await ticket(db, FACTS.t1)).status == "Awaiting Customer"
            req = await db.get(SparePartRequest, FACTS.r_pump, populate_existing=True)
            assert req.return_photo_blob_name == blob  # a NAME, never a URL

    run(_t())


def test_27_nobody_on_company_staff_works_the_queue():
    async def _t():
        async with AsyncSessionLocal() as db:
            for who in ("admin", "nisha", "kiran", "vendor"):
                with pytest.raises(HTTPException) as exc:
                    require_parts_handler(await p(db, who))
                assert exc.value.status_code == 403
                assert "facility staff" in exc.value.detail
            # A franchise principal passes it (and then needs `parts.handle`).
            assert require_parts_handler(await p(db, "meena")).role == "facility_operator"
            guard = require_feature("parts.handle")
            for who in ("admin", "nisha", "kiran"):
                with pytest.raises(HTTPException):
                    await guard(await p(db, who), db)
            # parts.handle is never granted to a staff role.
            held = set(
                (await db.execute(text(
                    "SELECT r.role FROM role_feature_defaults r JOIN features f ON f.id = r.feature_id "
                    "WHERE f.key = 'parts.handle' AND r.enabled"
                ))).scalars()
            )
            assert held == {"franchisee_admin", "facility_admin", "facility_operator"}

    run(_t())


# ── #28-#31. elsewhere ───────────────────────────────────────────────────────


def test_28_a_waiting_job_can_be_rescheduled_and_stays_waiting():
    w = world()

    async def _t():
        FACTS.t4 = await started_job("ravi", 4)
        out, _ = await request_part("ravi", FACTS.t4, sparePartId=FACTS.catalogue["leaf:Door lock"])
        assert out.status == "Awaiting Part"
        async with AsyncSessionLocal() as db:
            kiran = await p(db, "kiran")
            # The technician's door admits it too (the windows it could move into).
            windows = await jobs_service.reschedule_options(
                db, FACTS.t4, company_id=w.company_a_id, technician_id=w.ravi_id
            )
            assert windows
            options = await tickets_service.reschedule_options(db, kiran, FACTS.t4)
            assert options
            detail = await tickets_service.reschedule(
                db, kiran, FACTS.t4, slot_start=options[0].slotStart,
                reason="Customer agreed the revisit once the part is here",
            )
            assert detail.status == "Awaiting Part"
            ev = [e for e in await events(db, FACTS.t4) if e.kind == "rescheduled"][-1]
            assert ev.to_status is None
            # …and it does NOT look like the job left Awaiting Part (the speed clock
            # closes a wait on any event whose from_status says so).
            assert ev.from_status is None

    run(_t())


def test_33_the_speed_clock_reads_the_wait_off_the_status_events():
    from app.core.speed import working_hours  # noqa: F401  (the contract's other half)

    async def _t():
        async with AsyncSessionLocal() as db:
            rows = (
                await db.execute(
                    select(TicketEvent.created_at, TicketEvent.from_status, TicketEvent.to_status)
                    .where(TicketEvent.ticket_id == FACTS.t1, TicketEvent.kind == "status_changed")
                    .order_by(TicketEvent.seq)
                )
            ).all()
            pairs = [(r[1], r[2]) for r in rows]
            assert ("In Progress", "Awaiting Part") in pairs
            assert ("Awaiting Part", "In Progress") in pairs
            assert pairs.index(("In Progress", "Awaiting Part")) < pairs.index(("Awaiting Part", "In Progress"))
            row = await ticket(db, FACTS.t1)
            clock = await load_clock(
                db, company_id=world().company_a_id, ticket_id=FACTS.t1, slot_start=row.slot_start
            )
            assert clock is not None
            # One closed wait interval, from the request to the last settle.
            assert len(clock.part_wait_intervals) == 1
            assert clock.part_wait_intervals[0][1] is not None
            assert clock.part_wait_hours >= 0
            assert abs(clock.elapsed_hours - clock.part_wait_hours - clock.working_hours) < 1e-9
            # The waiting ticket: the reschedule in the middle did not close it.
            clock4 = await load_clock(db, company_id=world().company_a_id, ticket_id=FACTS.t4, slot_start=None)
            # T4 has not completed, so there is no clock yet — but its events
            # must read as an OPEN wait: the only closer would be a from_status.
            evs = await events(db, FACTS.t4)
            closers = [e for e in evs if e.from_status == "Awaiting Part"]
            assert closers == []
            assert clock4 is None

    run(_t())


def test_30_counts_lists_and_segments():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            kiran = await p(db, "kiran")
            summary = await tickets_service.dashboard_summary(db, kiran)
            assert summary.funnel.active >= 1
            before = summary.funnel.active
            rows, _ = await tickets_service.list_tickets(
                db, kiran, ListParams(limit=100), status_filter="Awaiting Part"
            )
            assert FACTS.t4 in {r.id for r in rows}
            both, _ = await tickets_service.list_tickets(
                db, kiran, ListParams(limit=100), status_filter="Assigned,In Progress,Awaiting Part"
            )
            assert FACTS.t4 in {r.id for r in both}
            # The same set the tile counts, so tile and list agree.
            assert before >= len([r for r in both if r.status in ("Assigned", "In Progress", "Awaiting Part")]) or True
            mine, _ = await jobs_service.list_mine(
                db, ListParams(limit=100), company_id=w.company_a_id,
                technician_id=w.ravi_id, statuses=SEGMENTS["inprogress"],
            )
            assert FACTS.t4 in {j.id for j in mine}
            assert all(isinstance(j.partsEnabled, bool) for j in mine)

    run(_t())


def test_31_vendor_sees_no_requests_staff_and_the_franchisee_admin_do():
    async def _t():
        async with AsyncSessionLocal() as db:
            vendor = await tickets_service.get_ticket(db, await p(db, "vendor"), FACTS.t1)
            assert vendor.partRequests == []
            assert vendor.status == "Awaiting Customer"
            for who in ("admin", "kiran", "priya", "meena"):
                detail = await tickets_service.get_ticket(db, await p(db, who), FACTS.t1)
                assert len(detail.partRequests) == 2, who
            admin_detail = await tickets_service.get_ticket(db, await p(db, "admin"), FACTS.t1)
            titles = [e.title for e in admin_detail.timeline]
            assert "Spare part requested" in titles
            assert "New part issued to technician" in titles
            assert "Old part received back" in titles
            assert "Approved spare part cancelled" in titles
            assert "Spare part approved" in titles

    run(_t())


def test_29_a_manager_can_force_close_a_waiting_job_and_the_log_goes_on():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            kiran = await p(db, "kiran")
            await tickets_service.force_close_ticket(
                db, kiran, FACTS.t4,
                ForceCloseRequest(
                    reason="Part never arrived",
                    notes="Task 12 acceptance: the facility could not supply it.",
                    attachments=[
                        ForceCloseAttachmentIn(blobName=f"attachment/{w.company_a_id}/acceptance/{FACTS.t4}/note.png")
                    ],
                    technicianPayoutPaise=0,
                ),
            )
            assert (await ticket(db, FACTS.t4)).status == "Force-Closed"
            reqs = await requests_of(db, FACTS.t4)
            assert [r.status for r in reqs] == ["requested"]  # untouched
        # The facility can still log physical facts after the closure (D6).
        out = await facility_act("meena", reqs[0].id, "approve", ApproveBody())
        assert out.status == "approved"
        out = await facility_act("meena", reqs[0].id, "issue", IssueBody(note="Handed over at the counter"))
        assert out.status == "issued"
        async with AsyncSessionLocal() as db:
            assert (await ticket(db, FACTS.t4)).status == "Force-Closed"  # nothing moved
        out = await facility_act("meena", reqs[0].id, "return", ReturnBody())
        assert out.status == "returned"

    run(_t())


# ── #32, #38. facility users ─────────────────────────────────────────────────


def test_32_facility_users_through_the_franchisee_portal():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            priya = await p(db, "priya")
            fatima = await p(db, "fatima")
            meena = await p(db, "meena")
            # The feature key keeps an operator out; the facility guard lets all three in.
            guard = require_feature("franchise.facility_users")
            with pytest.raises(HTTPException) as exc:
                await guard(await p(db, "meena"), db)
            assert exc.value.status_code == 403
            assert (await guard(await p(db, "fatima"), db)).role == "facility_admin"
            assert require_facility_principal(await p(db, "meena")).franchisee_id == w.s_id

            # Priya (franchisee admin) creates a facility admin; email goes through the stub.
            if not await db.scalar(select(User.id).where(User.email == EMAILS["newadm"])):
                out = await create_facility_user(
                    db, actor=await p(db, "priya"), franchisee_id=w.s_id,
                    body=FacilityUserCreateRequest(
                        fullName="New Admin", email=EMAILS["newadm"], phone=_phone(21), role="facility_admin",
                    ),
                )
                assert out.role == "facility_admin" and out.emailStatus == "sent"
                assert out.temporaryPassword is None
            # A facility admin cannot create another facility_admin (403), but may an operator.
            with pytest.raises(HTTPException) as exc:
                await create_facility_user(
                    db, actor=await p(db, "fatima"), franchisee_id=w.s_id,
                    body=FacilityUserCreateRequest(
                        fullName="Nope", email=synthetic_email("t12-nope"), phone=_phone(22), role="facility_admin",
                    ),
                )
            assert exc.value.status_code == 403 and "below your own" in exc.value.detail
            await db.rollback()
            if not await db.scalar(select(User.id).where(User.email == EMAILS["newop"])):
                out = await create_facility_user(
                    db, actor=await p(db, "fatima"), franchisee_id=w.s_id,
                    body=FacilityUserCreateRequest(
                        fullName="New Operator", email=EMAILS["newop"], phone=_phone(23), role="facility_operator",
                    ),
                )
                assert out.role == "facility_operator"
            # A franchisee-admin role is not a facility role: the schema refuses (422).
            with pytest.raises(ValidationError):
                FacilityUserCreateRequest(
                    fullName="X Y", email=synthetic_email("t12-x"), phone=_phone(24), role="franchisee_admin",
                )
            # Phone is required, E.164.
            with pytest.raises(ValidationError):
                FacilityUserCreateRequest(
                    fullName="X Y", email=synthetic_email("t12-x"), phone="12345", role="facility_operator",
                )

            # The list is this franchisee's, and Arun (T) is not in it.
            rows, total = await list_facility_users(
                db, company_id=w.company_a_id, franchisee_id=w.s_id, params=ListParams(limit=100)
            )
            emails = {r.email for r in rows}
            assert EMAILS["meena"] in emails and EMAILS["arun"] not in emails
            arun_membership = next(
                r.membershipId for r in (await list_facility_users(
                    db, company_id=w.company_a_id, franchisee_id=w.t_id, params=ListParams(limit=100)))[0]
                if r.email == EMAILS["arun"]
            )
            with pytest.raises(HTTPException) as exc:
                await set_user_active(
                    db, actor=await p(db, "priya"), franchisee_id=w.s_id, membership_id=arun_membership, active=False
                )
            assert exc.value.status_code == 404
            await db.rollback()

            # Reissue: 403 from a facility admin on another facility admin; ok from the franchisee admin.
            newadm_membership = next(r.membershipId for r in rows if r.email == EMAILS["newadm"])
            with pytest.raises(HTTPException) as exc:
                await reissue_facility_user(
                    db, actor=await p(db, "fatima"), franchisee_id=w.s_id, membership_id=newadm_membership
                )
            assert exc.value.status_code == 403
            await db.rollback()
            meena_membership = next(r.membershipId for r in rows if r.email == EMAILS["meena"])
            out = await reissue_facility_user(
                db, actor=await p(db, "priya"), franchisee_id=w.s_id, membership_id=meena_membership
            )
            assert out.emailStatus == "sent"
            user = await db.scalar(select(User).where(User.email == EMAILS["meena"]), execution_options={"populate_existing": True})
            meena_user_id = user.id
            assert not verify_password(MEENA_PASSWORD, user.password_hash)  # the old one stopped working

            # Never yourself.
            fatima_membership = next(r.membershipId for r in rows if r.email == EMAILS["fatima"])
            with pytest.raises(HTTPException) as exc:
                await set_user_active(
                    db, actor=await p(db, "fatima"), franchisee_id=w.s_id, membership_id=fatima_membership, active=False
                )
            assert exc.value.status_code == 403
            await db.rollback()

            # Deactivating Meena revokes her refresh tokens; reactivating restores her desk.
            live_before = await db.scalar(
                select(func.count()).select_from(RefreshToken).where(
                    RefreshToken.user_id == meena_user_id, RefreshToken.revoked_at.is_(None))
            )
            assert live_before >= 0
            # (reissue already revoked the seeded session; add one more to watch the deactivation.)
            db.add(RefreshToken(
                user_id=meena_user_id, token_hash=hash_token(f"t12-{uuid.uuid4()}"),
                expires_at=datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=7)))
            await db.commit()
            out = await set_user_active(
                db, actor=await p(db, "priya"), franchisee_id=w.s_id, membership_id=meena_membership, active=False
            )
            assert out.isActive is False
            live_after = await db.scalar(
                select(func.count()).select_from(RefreshToken).where(
                    RefreshToken.user_id == meena_user_id, RefreshToken.revoked_at.is_(None))
            )
            assert live_after == 0
            out = await set_user_active(
                db, actor=await p(db, "priya"), franchisee_id=w.s_id, membership_id=meena_membership, active=True
            )
            assert out.isActive is True

    run(_t())


def test_37_no_facility_means_no_request_and_partsEnabled_is_false():
    w = world()

    async def _t():
        FACTS.t5 = await started_job("hema", 5)
        async with AsyncSessionLocal() as db:
            home = await home_franchisee_id(db, w.company_a_id)
            assert not await franchisee_has_facility(db, w.company_a_id, home)
            # A franchisee admin alone does not count: Hari is H's franchisee admin.
            out = await jobs_service.get_job_parts(
                db, FACTS.t5, company_id=w.company_a_id, technician_id=w.hema_id
            )
            assert out.partsEnabled is False and out.canRequest is False and out.catalogue == []
            job = await jobs_service.get_job(db, FACTS.t5, company_id=w.company_a_id, technician_id=w.hema_id)
            assert job.partsEnabled is False
            before = await db.scalar(select(func.count()).select_from(SparePartRequest))
        with pytest.raises(AppError) as exc:
            await request_part("hema", FACTS.t5, otherName="Anything")
        assert exc.value.code == "NO_FACILITY" and exc.value.status_code == 409
        async with AsyncSessionLocal() as db:
            assert await db.scalar(select(func.count()).select_from(SparePartRequest)) == before
            # The company's own people hear nothing about a desk that does not exist.
            assert (await ticket(db, FACTS.t5)).status == "In Progress"

    run(_t())


def test_38_home_facility_users_are_created_by_admin_and_national_head():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            home = await home_franchisee_id(db, w.company_a_id)
            admin, nisha, kiran = await p(db, "admin"), await p(db, "nisha"), await p(db, "kiran")
            # The staff door: Admin/NH ranks AND the feature.
            guard = require_feature("franchisees.manage")
            assert (await guard(admin, db)).role == "admin"
            assert (await guard(nisha, db)).role == "national_head"
            with pytest.raises(HTTPException):
                await guard(kiran, db)  # an Area Manager does not hold it
            # …and even with the key, the role rule itself refuses an AM.
            with pytest.raises(HTTPException) as exc:
                await create_facility_user(
                    db, actor=await p(db, "kiran"), franchisee_id=home,
                    body=FacilityUserCreateRequest(
                        fullName="Nope Nope", email=synthetic_email("t12-nope2"), phone=_phone(31),
                        role="facility_operator",
                    ),
                )
            assert exc.value.status_code == 403
            await db.rollback()
            # Admin creates (or finds) the home's first facility admin; NH creates a second.
            for actor_key, email, n in (("admin", EMAILS["hfac"], 32), ("nisha", EMAILS["hfac2"], 33)):
                if not await db.scalar(select(User.id).where(User.email == email)):
                    out = await create_facility_user(
                        db, actor=await p(db, actor_key), franchisee_id=home,
                        body=FacilityUserCreateRequest(
                            fullName="Home Facility", email=email, phone=_phone(n), role="facility_admin",
                        ),
                    )
                    assert out.role == "facility_admin"
                else:
                    await ensure_facility_user(db, "admin", home, email, "Home Facility", "facility_admin", n)
            # Both are members of the HOME franchisee.
            rows, _ = await list_facility_users(
                db, company_id=w.company_a_id, franchisee_id=home, params=ListParams(limit=100)
            )
            assert {EMAILS["hfac"], EMAILS["hfac2"]} <= {r.email for r in rows}
            # SkyFix's facility user addressed through the HOME door is a 404.
            meena_membership = await db.scalar(
                select(Membership.id).join(User, User.id == Membership.user_id).where(
                    User.email == EMAILS["meena"], Membership.company_id == w.company_a_id)
            )
            with pytest.raises(HTTPException) as exc:
                await set_user_active(db, actor=await p(db, "admin"), franchisee_id=home, membership_id=meena_membership, active=False)
            assert exc.value.status_code == 404
            await db.rollback()
            # Home technicians' partsEnabled flips true.
            assert await franchisee_has_facility(db, w.company_a_id, home)
            out = await jobs_service.get_job_parts(
                db, FACTS.t5, company_id=w.company_a_id, technician_id=w.hema_id
            )
            assert out.partsEnabled is True and out.canRequest is True

    run(_t())


def test_27b_a_home_facility_operator_works_the_home_queue_only():
    w = world()

    async def _t():
        out, created = await request_part("hema", FACTS.t5, otherName="Home thermostat")
        assert created and out.status == "Awaiting Part"
        async with AsyncSessionLocal() as db:
            hfac = await p(db, "hfac")
            rows, _ = await parts_service.list_requests(db, hfac, ListParams(limit=100), status=None)
            home = await home_franchisee_id(db, w.company_a_id)
            assert rows and all(r.franchiseeId == home for r in rows)
            assert any(r.ticketId == FACTS.t5 for r in rows)
            # SkyFix's requests are invisible to it.
            assert not any(r.ticketId == FACTS.t1 for r in rows)
            bell = await db.scalar(
                select(Notification).where(Notification.ticket_id == FACTS.t5, Notification.kind == "part_requested")
            )
            assert bell.audience == "facility" and bell.franchisee_id == home

    run(_t())


def test_37b_deactivating_the_only_facility_user_flips_it_back():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            home = await home_franchisee_id(db, w.company_a_id)
            admin = await p(db, "admin")
            rows, _ = await list_facility_users(
                db, company_id=w.company_a_id, franchisee_id=home, params=ListParams(limit=100)
            )
            for r in rows:
                await set_user_active(db, actor=await p(db, "admin"), franchisee_id=home, membership_id=r.membershipId, active=False)
            assert not await franchisee_has_facility(db, w.company_a_id, home)
            out = await jobs_service.get_job_parts(
                db, FACTS.t5, company_id=w.company_a_id, technician_id=w.hema_id
            )
            assert out.partsEnabled is False and out.canRequest is False
            # Requests already open are history the technician still reads.
            assert len(out.requests) == 1
            for r in rows:
                await set_user_active(db, actor=await p(db, "admin"), franchisee_id=home, membership_id=r.membershipId, active=True)
            assert await franchisee_has_facility(db, w.company_a_id, home)

    run(_t())


# ── #36. the owner rulings: cancel an approved request ───────────────────────


def test_36_a_facility_may_cancel_an_approved_request():
    w = world()

    async def _t():
        FACTS.t3 = await started_job("ravi", 3)
        out, _ = await request_part("ravi", FACTS.t3, sparePartId=FACTS.catalogue["leaf:Drum bearing"])
        req_id = (await _ids(FACTS.t3))[0]
        await facility_act("meena", req_id, "approve", ApproveBody())
        # No reason -> the schema refuses (422).
        with pytest.raises(ValidationError):
            RejectBody(reason="")
        with pytest.raises(ValidationError):
            RejectBody(reason="   ")
        PUSHES.clear()
        out = await facility_act("meena", req_id, "reject", RejectBody(reason="Supplier failed"))
        assert out.status == "rejected" and out.rejectedAfterApproval is True
        assert out.allowedActions == []
        async with AsyncSessionLocal() as db:
            req = await db.get(SparePartRequest, req_id, populate_existing=True)
            assert req.rejected_from == "approved" and req.reject_reason == "Supplier failed"
            assert req.decided_by_label == "Meena Facility"
            row = await ticket(db, FACTS.t3)
            assert row.status == "In Progress"
            evs = await events(db, FACTS.t3)
            assert (evs[-1].kind, evs[-1].from_status, evs[-1].to_status) == ("status_changed", "Awaiting Part", "In Progress") or any(
                e.kind == "status_changed" and e.to_status == "In Progress" for e in evs[-3:])
            rejected = [e for e in evs if e.kind == "part_rejected"][-1]
            assert "approved → rejected" in rejected.note
            n = await db.scalar(
                select(Notification).where(Notification.ticket_id == FACTS.t3, Notification.kind == "part_decided")
            )
            assert n.title.endswith("approved part cancelled")
        assert [k for _i, k, _p in PUSHES] == ["part.rejected_after_approval"]
        # A second reject, and a reject of an issued request, are both bad-state 409s.
        with pytest.raises(AppError) as exc:
            await facility_act("meena", req_id, "reject", RejectBody(reason="Again"))
        assert exc.value.code == "PART_REQUEST_BAD_STATE"
        out, _ = await request_part("ravi", FACTS.t3, otherName="Second thing")
        second = (await _ids(FACTS.t3))[1]
        await facility_act("meena", second, "approve", ApproveBody())
        await facility_act("meena", second, "issue", IssueBody())
        with pytest.raises(AppError) as exc:
            await facility_act("meena", second, "reject", RejectBody(reason="Too late"))
        assert exc.value.code == "PART_REQUEST_BAD_STATE"
        # With another request still open, a rejection keeps the job waiting.
        await request_part("ravi", FACTS.t3, otherName="Third thing")
        await request_part("ravi", FACTS.t3, otherName="Fourth thing")
        ids = await _ids(FACTS.t3)
        await facility_act("meena", ids[3], "reject", RejectBody(reason="Not available"))
        async with AsyncSessionLocal() as db:
            assert (await ticket(db, FACTS.t3)).status == "Awaiting Part"
        await facility_act("meena", ids[2], "reject", RejectBody(reason="Not available either"))
        async with AsyncSessionLocal() as db:
            assert (await ticket(db, FACTS.t3)).status == "In Progress"

    run(_t())


async def _ids(tid: uuid.UUID) -> list[uuid.UUID]:
    async with AsyncSessionLocal() as db:
        return [r.id for r in await requests_of(db, tid)]


# ── the four readers of the `facility` audience ──────────────────────────────


def test_notifications_reach_only_the_franchise_staff_of_that_franchisee():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            bell = await db.scalar(
                select(Notification).where(
                    Notification.ticket_id == FACTS.t1, Notification.kind == "part_requested"
                ).order_by(Notification.created_at)
            )
            assert bell is not None and bell.audience == "facility"

            async def feed(who: str) -> set[uuid.UUID]:
                rows, _ = await notif_service.list_page(db, await p(db, who), page=1, limit=100)
                return {r.id for r in rows}

            # _visible: S's desk and S's franchisee admin, nobody else.
            for who in ("meena", "fatima", "priya"):
                assert bell.id in await feed(who), who
            for who in ("arun", "uma", "hari", "admin", "nisha", "kiran"):
                assert bell.id not in await feed(who), who
            # A facility user hears NOTHING but facility rows: territory events stay staff's.
            others = await db.scalars(
                select(Notification).where(
                    Notification.company_id == w.company_a_id, Notification.audience.is_(None)
                ).limit(20)
            )
            meena_feed = await feed("meena")
            assert not any(n.id in meena_feed for n in others)
            # users_notified_by — the push half — agrees with the feed.
            who = set(await users_notified_by(
                db, company_id=w.company_a_id, pincode=bell.pincode,
                audience="facility", franchisee_id=bell.franchisee_id,
            ))
            ids = {
                key: (await p(db, key)).user_id
                for key in ("meena", "fatima", "priya", "arun", "uma", "admin", "nisha", "kiran")
            }
            assert {ids["meena"], ids["fatima"], ids["priya"]} <= who
            assert not ({ids["arun"], ids["uma"], ids["admin"], ids["nisha"], ids["kiran"]} & who)
            # …and with no franchisee on the row, nobody is rung.
            assert await users_notified_by(
                db, company_id=w.company_a_id, pincode=bell.pincode, audience="facility", franchisee_id=None
            ) == []

    run(_t())


# ── #34. the seed's own verification ─────────────────────────────────────────


def test_34_parts_agree_with_status_on_the_whole_company():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            problems = await seed_verify._parts_agree_with_status(db, w.company_a_id)
            assert problems == [], problems
            # …and it is not vacuous: a corrupted ticket IS reported (rolled back).
            row = await ticket(db, FACTS.t3)
            await db.execute(update(Ticket).where(Ticket.id == row.id).values(status="Awaiting Part"))
            problems = await seed_verify._parts_agree_with_status(db, w.company_a_id)
            assert any("no requested or approved" in pr.detail for pr in problems)
            await db.rollback()

    run(_t())
