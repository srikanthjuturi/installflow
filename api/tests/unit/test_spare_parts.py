"""Task 12 §6 — spare parts, the pure half. No database (X1).

The state machine, the job-status function, the catalogue merge, the role rule,
the request schema and the push copy: everything §6 pins, plus the checks that
keep the model, the migration and the services speaking one vocabulary.
"""

import importlib.util
import re
import uuid
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core.push_text import LANGUAGES, MESSAGES, PushText
from app.core.spare_parts import (
    ACTIONS,
    REQUESTABLE_STATUSES,
    TRANSITIONS,
    CatalogueRow,
    allowed_actions,
    can_create_facility_role,
    job_status_after,
    merge_catalogue,
    next_status,
    normalize_part_name,
    part_name_key,
)
from app.features.jobs.schemas import PartRequestCreate
from app.models.notification import AUDIENCES, NOTIFICATION_KINDS
from app.models.spare_part import (
    OPEN_PART_REQUEST_STATUSES,
    PART_REQUEST_STATUSES,
    SparePart,
    SparePartRequest,
)
from app.models.ticket_event import EVENT_KINDS


# ── the state machine (P4 as amended by R2 / D23) ────────────────────────────

_ALL_PAIRS = [(s, a) for s in PART_REQUEST_STATUSES for a in ACTIONS]
_EXPECTED = {
    ("requested", "approve"): "approved",
    ("requested", "reject"): "rejected",
    ("approved", "issue"): "issued",
    ("approved", "reject"): "rejected",
    ("issued", "return"): "returned",
}


def test_the_table_has_exactly_five_pairs() -> None:
    assert dict(TRANSITIONS) == _EXPECTED
    assert len(_ALL_PAIRS) == 20  # five give a target, the other fifteen None


@pytest.mark.parametrize("status,action", _ALL_PAIRS)
def test_transition_table_is_exactly_p4(status: str, action: str) -> None:
    assert next_status(status, action) == _EXPECTED.get((status, action))


def test_terminal_and_issued_rules() -> None:
    for action in ACTIONS:
        assert next_status("rejected", action) is None
        assert next_status("returned", action) is None
    # A part already handed over is returned, never rejected.
    assert next_status("issued", "reject") is None
    # An unknown status or action is simply "may not".
    assert next_status("nonsense", "approve") is None
    assert next_status("requested", "nonsense") is None


def test_allowed_actions() -> None:
    assert allowed_actions("requested") == ["approve", "reject"]
    assert allowed_actions("approved") == ["issue", "reject"]
    assert allowed_actions("issued") == ["return"]
    assert allowed_actions("rejected") == []
    assert allowed_actions("returned") == []


# ── the job's status is a function of its requests (D5) ──────────────────────


@pytest.mark.parametrize(
    "current,statuses,expected",
    [
        ("In Progress", [], "In Progress"),
        ("In Progress", ["requested"], "Awaiting Part"),
        ("In Progress", ["approved"], "Awaiting Part"),
        ("Awaiting Part", ["approved", "rejected"], "Awaiting Part"),
        ("Awaiting Part", ["issued", "rejected", "returned"], "In Progress"),
        ("Awaiting Part", [], "In Progress"),
        # R2: the last open one rejected AFTER approval is just `rejected`.
        ("Awaiting Part", ["rejected"], "In Progress"),
        ("Awaiting Part", ["rejected", "approved"], "Awaiting Part"),
        ("Awaiting Part", ["issued", "requested"], "Awaiting Part"),
    ],
)
def test_job_status_after_moves_only_the_two(current: str, statuses: list[str], expected: str) -> None:
    assert job_status_after(current, statuses) == expected


@pytest.mark.parametrize(
    "current", ["Assigned", "Awaiting Customer", "Closed", "Force-Closed", "New", "Escalated", "Cancelled"]
)
def test_job_status_after_leaves_every_other_status_alone(current: str) -> None:
    for statuses in ([], ["requested"], ["approved", "issued"], ["rejected"]):
        assert job_status_after(current, statuses) == current


def test_open_statuses_are_requested_and_approved() -> None:
    assert OPEN_PART_REQUEST_STATUSES == ("requested", "approved")
    assert REQUESTABLE_STATUSES == ("In Progress", "Awaiting Part")


# ── the inherited catalogue (D11) ────────────────────────────────────────────

_HA, _WM, _FL, _MODEL = uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4()


def _row(name: str, level: int, *, active: bool = True, owner: uuid.UUID | None = None) -> CatalogueRow:
    owners = {0: ("Home Appliances", _HA), 1: ("Washing Machine", _WM), 2: ("Front Load", _FL), 3: ("Acme FL-7", _MODEL)}
    owner_name, owner_id = owners[level]
    return CatalogueRow(
        id=owner or uuid.uuid4(),
        name=name,
        is_active=active,
        level=level,
        owner_kind="model" if level == 3 else "node",
        owner_id=owner_id,
        owner_name=owner_name,
    )


def _worked_example() -> list[CatalogueRow]:
    return [
        _row("Power cord", 0),
        _row("Drain pump", 1),
        _row("Inlet hose", 1),
        _row("Door gasket", 1),
        _row("Door lock", 2),
        _row("Drum bearing", 2),
        _row("Control board FL-7", 3),
        _row("Door gasket", 3, active=False),  # the FL-7 gasket is not a field part
    ]


def test_merge_inherits_root_first_plus_model() -> None:
    names = [r.name for r in merge_catalogue(_worked_example())]
    assert names == [
        "Control board FL-7",
        "Door lock",
        "Drain pump",
        "Drum bearing",
        "Inlet hose",
        "Power cord",
    ]


def test_merge_deepest_wins_and_inactive_hides() -> None:
    # Active at level 1, inactive at the model -> hidden.
    assert "Door gasket" not in [r.name for r in merge_catalogue(_worked_example())]
    # The reverse: inactive at level 1, active at the model -> present, and the
    # returned row is the MODEL's.
    model_gasket = uuid.uuid4()
    rows = [
        _row("Door gasket", 1, active=False),
        _row("Door gasket", 3, owner=model_gasket),
    ]
    merged = merge_catalogue(rows)
    assert [r.name for r in merged] == ["Door gasket"]
    assert merged[0].id == model_gasket
    assert merged[0].owner_kind == "model"


def test_merge_case_and_space_insensitive() -> None:
    leaf = uuid.uuid4()
    merged = merge_catalogue([_row("Drain Pump", 0), _row(" drain  pump", 2, owner=leaf)])
    assert len(merged) == 1
    assert merged[0].id == leaf


def test_merge_sorted_by_name() -> None:
    merged = merge_catalogue(_worked_example())
    keys = [part_name_key(r.name) for r in merged]
    assert keys == sorted(keys)


def test_merge_of_nothing_is_nothing() -> None:
    assert merge_catalogue([]) == []


def test_normalize_part_name() -> None:
    assert normalize_part_name("  Drain   PUMP \n") == "Drain PUMP"
    assert normalize_part_name("a\t\tb") == "a b"
    assert part_name_key("  Drain   PUMP ") == "drain pump"


# ── who may create which facility role (P6, R4) ─────────────────────────────


@pytest.mark.parametrize(
    "actor,target,allowed",
    [
        ("franchisee_admin", "facility_admin", True),
        ("franchisee_admin", "facility_operator", True),
        ("franchisee_admin", "franchisee_admin", False),
        ("facility_admin", "facility_operator", True),
        ("facility_admin", "facility_admin", False),
        ("facility_admin", "franchisee_admin", False),
        ("facility_operator", "facility_operator", False),
        ("facility_operator", "facility_admin", False),
        # Owner ruling 2026-10-15 (R4): the company's Admin / National Head, for
        # the HOME franchisee (the route enforces the franchisee).
        ("admin", "facility_admin", True),
        ("admin", "facility_operator", True),
        ("admin", "franchisee_admin", False),
        ("national_head", "facility_admin", True),
        ("national_head", "facility_operator", True),
        ("national_head", "franchisee_admin", False),
        ("regional_head", "facility_operator", False),
        ("area_manager", "facility_operator", False),
        ("technician", "facility_operator", False),
        ("vendor", "facility_operator", False),
    ],
)
def test_can_create_facility_role(actor: str, target: str, allowed: bool) -> None:
    assert can_create_facility_role(actor, target) is allowed


# ── the technician's request body ────────────────────────────────────────────


def test_part_request_create_exactly_one() -> None:
    with pytest.raises(ValidationError):
        PartRequestCreate()
    with pytest.raises(ValidationError):
        PartRequestCreate(sparePartId=uuid.uuid4(), otherName="Hose clamp")
    assert PartRequestCreate(sparePartId=uuid.uuid4()).otherName is None
    assert PartRequestCreate(otherName="Hose clamp").sparePartId is None
    with pytest.raises(ValidationError):
        PartRequestCreate(otherName="x" * 121)
    assert PartRequestCreate(otherName="x" * 120).otherName == "x" * 120


def test_part_request_create_normalises_and_bounds() -> None:
    body = PartRequestCreate(otherName="  Inlet   hose  clamp ", note="  cracked  ")
    assert body.otherName == "Inlet hose clamp"
    assert body.note == "cracked"
    # A name that is only spaces is not a name.
    with pytest.raises(ValidationError):
        PartRequestCreate(otherName="    ")
    assert PartRequestCreate(sparePartId=uuid.uuid4(), note="   ").note is None
    with pytest.raises(ValidationError):
        PartRequestCreate(sparePartId=uuid.uuid4(), note="n" * 501)


# ── push copy (D15) ─────────────────────────────────────────────────────────


def test_push_text_part_keys() -> None:
    for lang in LANGUAGES:
        title, body = PushText("part.issued", code="RGT-INST-0412", part="Drain pump").render(lang)
        assert "RGT-INST-0412" in title
        assert body.strip()
        title, body = PushText(
            "part.rejected_after_approval",
            code="RGT-INST-0412",
            part="Drain pump",
            reason="Supplier failed",
        ).render(lang)
        assert "RGT-INST-0412" in title
        assert "Supplier failed" in body
        assert "Drain pump" in body
        title, body = PushText(
            "part.rejected", code="RGT-INST-0412", part="Drain pump", reason="Not stocked"
        ).render(lang)
        assert "RGT-INST-0412" in title and "Not stocked" in body
        title, _ = PushText("part.approved", code="RGT-INST-0412", part="Drain pump").render(lang)
        assert "RGT-INST-0412" in title


def test_the_four_part_pushes_exist_in_all_five_languages() -> None:
    for key in ("part.approved", "part.rejected", "part.rejected_after_approval", "part.issued"):
        assert set(MESSAGES[key]) == set(LANGUAGES)


# ── the vocabularies agree: model <-> migration <-> services ─────────────────

_MIGRATION = (
    Path(__file__).resolve().parents[2] / "alembic" / "versions" / "d6c3a9f1e874_spare_parts.py"
)
_spec = importlib.util.spec_from_file_location("migration_d6c3a9f1e874", _MIGRATION)
assert _spec is not None and _spec.loader is not None
migration = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(migration)


def _check_sql(model: type, name: str) -> str:
    table = model.__table__  # type: ignore[attr-defined]
    for c in table.constraints:
        sql = getattr(c, "sqltext", None)
        if sql is not None and str(c.name) in (name, f"ck_{table.name}_{name}"):
            return str(sql)
    raise AssertionError(f"no CHECK {name}")


def test_migration_identity() -> None:
    assert migration.revision == "d6c3a9f1e874"
    assert migration.down_revision == "b4a8e2f6c903"


# ── downgrade() refuses while a request or a waiting ticket exists ──────────
# `downgrade()` opens with `bind = op.get_bind()` then two `bind.execute(sa.text(
# ...)).scalar()` calls, and raises BEFORE any `op.drop_*` if either count is
# truthy. A fake bind that only answers those two SELECTs is enough to drive it
# — no database, no alembic migration context.


class _FakeBind:
    """Answers only the two counts the guard asks for, keyed by a substring of
    the SQL text; anything else is a mistake in the test, not the migration."""

    def __init__(self, counts: dict[str, int]) -> None:
        self._counts = counts

    def execute(self, clause, *args, **kwargs):  # noqa: ANN001 - test double
        text = str(clause)
        for needle, value in self._counts.items():
            if needle in text:
                return _FakeResult(value)
        raise AssertionError(f"unexpected query in downgrade(): {text}")


class _FakeResult:
    def __init__(self, value: int) -> None:
        self._value = value

    def scalar(self) -> int:
        return self._value


@pytest.mark.parametrize(
    "waiting,requests",
    [(3, 0), (0, 5), (2, 7)],
    ids=["only-waiting-tickets", "only-requests", "both"],
)
def test_downgrade_refuses_while_rows_exist(
    monkeypatch: pytest.MonkeyPatch, waiting: int, requests: int
) -> None:
    fake_bind = _FakeBind({"Awaiting Part": waiting, "spare_part_requests": requests})
    monkeypatch.setattr(migration.op, "get_bind", lambda: fake_bind)
    with pytest.raises(RuntimeError) as exc_info:
        migration.downgrade()
    message = str(exc_info.value)
    assert "spare part request(s) exist" in message
    assert f"{requests} spare part request(s) exist" in message
    assert f"{waiting} ticket(s) are Awaiting Part" in message


def test_migration_values_parse_from_both_spellings() -> None:
    # pg_get_constraintdef's `ARRAY['x'::character varying, ...]` and the
    # migration's own comma list must read as the same set.
    live = "CHECK (((kind)::text = ANY ((ARRAY['a'::character varying, 'b c'::character varying])::text[])))"
    assert migration._values(live) == {"a", "b c"}
    assert migration._values("'a', 'b c'") == {"a", "b c"}


def test_migration_lists_are_the_models_vocabulary() -> None:
    from app.core.tickets import TICKET_STATUSES
    from app.models.notification import Notification
    from app.models.ticket import Ticket
    from app.models.ticket_event import TicketEvent

    values = migration._values
    assert values(migration._STATUS_BEFORE) | {"Awaiting Part"} == set(TICKET_STATUSES)
    assert values(migration._EVENTS_BEFORE) | values(migration._NEW_EVENTS) == set(EVENT_KINDS)
    # Task 12's migration describes the vocabulary AT d6c3a9f1e874; kinds added by later
    # migrations (Task 18's `ticket_handed`, f3b9d1a6c845) are theirs, not this file's.
    assert values(migration._NOTIFICATIONS_BEFORE) | values(migration._NEW_NOTIFICATIONS) == set(
        NOTIFICATION_KINDS
    ) - {"ticket_handed"}
    assert values(migration._AUDIENCES_BEFORE) | {"facility"} == set(AUDIENCES)
    # …and the models' own CHECK text carries every one of them.
    assert values(_check_sql(Ticket, "status")) == set(TICKET_STATUSES)
    assert values(_check_sql(TicketEvent, "kind")) == set(EVENT_KINDS)
    assert values(_check_sql(Notification, "kind")) == set(NOTIFICATION_KINDS)
    assert values(_check_sql(Notification, "audience")) == set(AUDIENCES)


def test_new_values_fit_their_columns() -> None:
    # ticket_events.kind String(32), notifications.kind String(24),
    # notifications.audience String(16) — a longer value would fail at INSERT.
    assert all(len(k) <= 32 for k in EVENT_KINDS)
    assert all(len(k) <= 24 for k in NOTIFICATION_KINDS)
    assert all(len(a) <= 16 for a in AUDIENCES)


def test_the_request_checks_are_the_state_machine_made_structural() -> None:
    names = {c.name for c in SparePartRequest.__table__.constraints if c.name}  # type: ignore[attr-defined]
    for expected in (
        "ck_spare_part_requests_status",
        "ck_spare_part_requests_one_part",
        "ck_spare_part_requests_decided_matches_status",
        "ck_spare_part_requests_rejected_has_reason",
        "ck_spare_part_requests_rejected_from_matches_status",
        "ck_spare_part_requests_issued_matches_status",
        "ck_spare_part_requests_returned_matches_status",
        "ck_spare_part_requests_photo_only_when_returned",
        "uq_spare_part_requests_company_code",
    ):
        assert expected in names, expected
    assert "ck_spare_parts_one_owner" in {c.name for c in SparePart.__table__.constraints if c.name}  # type: ignore[attr-defined]
    assert re.fullmatch(r"[a-z_]+", SparePartRequest.__tablename__)
