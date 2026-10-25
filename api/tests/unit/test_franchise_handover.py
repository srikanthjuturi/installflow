"""Task 18 §6, cases 1-25 - the pure hand-over decisions.

No database (X1): `app.core.franchise_handover` is stdlib plus `uuid`. The SQL twins (the pool predicate,
`technicians_covering`, `technicians_by_franchisee`) are proven against the dev database by
`tests/integration/test_task18_acceptance.py`; the route wiring is pinned here from the route table, because
FastAPI applies only the LAST `Depends` of a stacked `Annotated[...]` and a guard that is not in
`dependencies=[...]` silently never runs.
"""

import uuid

import pytest

from app.core import franchise_handover as fh
from app.features.tickets.router import router as tickets_router
from app.features.tickets.schemas import HandToFranchiseeRequest

S = uuid.uuid4()  # SkyFix - the current franchisee
A = uuid.uuid4()  # Acme Secunderabad - the target
H = uuid.uuid4()  # home


def _blocker(**over):
    base = dict(status="Slot Pending", has_technician=False, current=S, target=A, target_active=True)
    base.update(over)
    return fh.handover_blocker(**base)


# ── handover_blocker (1-10) ─────────────────────────────────────────────────


@pytest.mark.parametrize("status", ["New", "Slot Pending", "Escalated"])
def test_01_03_the_three_open_statuses_without_a_technician_can_move(status):
    assert _blocker(status=status) is None


def test_04_escalated_with_a_technician_is_assigned():
    # A customer's refusal: the ticket is Escalated but still held.
    assert _blocker(status="Escalated", has_technician=True) == "TICKET_ASSIGNED"


@pytest.mark.parametrize(
    "status", ["Assigned", "In Progress", "Awaiting Part", "Awaiting Customer", "AI Review"]
)
def test_05_live_statuses_are_assigned(status):
    assert _blocker(status=status, has_technician=True) == "TICKET_ASSIGNED"
    # Even if the technician column were somehow empty, the status alone refuses.
    assert _blocker(status=status, has_technician=False) == "TICKET_ASSIGNED"


@pytest.mark.parametrize("status", ["Closed", "Force-Closed", "Cancelled"])
def test_06_terminal_statuses_are_not_assignable_even_without_a_technician(status):
    assert _blocker(status=status, has_technician=False) == "TICKET_NOT_ASSIGNABLE"


def test_07_the_same_franchisee_is_refused():
    assert _blocker(target=S) == "SAME_FRANCHISEE"


def test_08_an_inactive_target_is_refused():
    assert _blocker(target_active=False) == "FRANCHISEE_INACTIVE"


def test_09_precedence_terminal_then_assigned_then_same_then_inactive():
    # terminal beats assigned
    assert _blocker(status="Closed", has_technician=True) == "TICKET_NOT_ASSIGNABLE"
    # assigned beats same
    assert _blocker(has_technician=True, target=S) == "TICKET_ASSIGNED"
    # same beats inactive
    assert _blocker(target=S, target_active=False) == "SAME_FRANCHISEE"
    # terminal beats same and inactive
    assert _blocker(status="Cancelled", target=S, target_active=False) == "TICKET_NOT_ASSIGNABLE"


def test_10_no_target_judges_the_ticket_side_only():
    assert _blocker(target=None) is None
    assert _blocker(target=None, target_active=False) is None
    assert _blocker(target=None, has_technician=True) == "TICKET_ASSIGNED"
    assert _blocker(target=None, status="Closed") == "TICKET_NOT_ASSIGNABLE"


def test_handover_statuses_are_f6s_re_stamp_set():
    assert fh.HANDOVER_STATUSES == ("New", "Slot Pending", "Escalated")
    assert set(fh.TERMINAL) == {"Closed", "Force-Closed", "Cancelled"}


# ── override_for / coverage_required / covers_ok (11-14) ────────────────────


def test_11_override_is_target_not_owner():
    assert fh.override_for(target=A, owner=A) is False
    assert fh.override_for(target=A, owner=S) is True


def test_12_handing_back_to_the_owner_clears_it():
    first = fh.override_for(target=A, owner=S)
    back = fh.override_for(target=S, owner=S)
    assert (first, back) == (True, False)


def test_13_coverage_is_required_only_of_the_pincodes_own_owner():
    assert fh.coverage_required(franchisee_id=S, owner_id=S) is True
    assert fh.coverage_required(franchisee_id=A, owner_id=S) is False


def test_13b_coverage_required_is_the_exact_complement_of_override_for():
    for target, owner in [(A, A), (A, S), (S, S), (H, S)]:
        assert fh.coverage_required(franchisee_id=target, owner_id=owner) is (
            not fh.override_for(target=target, owner=owner)
        )


def test_14_covers_ok():
    assert fh.covers_ok(covers=False, routing_override=True) is True
    assert fh.covers_ok(covers=False, routing_override=False) is False
    assert fh.covers_ok(covers=True, routing_override=False) is True
    assert fh.covers_ok(covers=True, routing_override=True) is True


# ── status_after (15-18) ────────────────────────────────────────────────────


def test_15_escalated_offerable_with_a_slot_goes_to_new():
    assert fh.status_after("Escalated", offerable=True, has_slot=True) == "New"


def test_16_escalated_offerable_without_a_slot_goes_to_slot_pending():
    assert fh.status_after("Escalated", offerable=True, has_slot=False) == "Slot Pending"


def test_17_escalated_with_a_closed_window_stays_escalated():
    assert fh.status_after("Escalated", offerable=False, has_slot=True) == "Escalated"
    assert fh.status_after("Escalated", offerable=False, has_slot=False) == "Escalated"


@pytest.mark.parametrize("was", ["New", "Slot Pending"])
@pytest.mark.parametrize("offerable", [True, False])
@pytest.mark.parametrize("has_slot", [True, False])
def test_18_new_and_slot_pending_keep_their_status(was, offerable, has_slot):
    assert fh.status_after(was, offerable=offerable, has_slot=has_slot) == was


# ── handover_note (19-22) ───────────────────────────────────────────────────


def test_19_the_note_names_both_franchisees_the_reason_and_the_arrow():
    note = fh.handover_note("SkyFix Services", "Acme Secunderabad", "no AC technician", back_in_pool=False)
    assert note == "SkyFix Services → Acme Secunderabad · handed over: no AC technician"


def test_20_back_in_the_pool_is_appended_only_when_true():
    on = fh.handover_note("A", "B", "why", back_in_pool=True)
    off = fh.handover_note("A", "B", "why", back_in_pool=False)
    assert on == off + " · back in the pool"
    assert "back in the pool" not in off


def test_21_a_reason_with_newlines_is_one_line_and_255_chars_survive_whole():
    note = fh.handover_note("A", "B", "line one\n  line   two\r\nthree", back_in_pool=False)
    assert "\n" not in note and "\r" not in note
    assert note.endswith("handed over: line one line two three")
    long = "x" * 255
    assert fh.handover_note("A", "B", long, back_in_pool=False).endswith(long)


def test_22_names_are_not_truncated():
    big = "N" * 120
    note = fh.handover_note(big, big + "2", "why", back_in_pool=False)
    assert note.startswith(big + " → " + big + "2")


# ── blocker_message (the PROPOSED sentences, §4.6) ──────────────────────────


def test_blocker_messages_are_the_proposed_copy():
    assert fh.blocker_message(
        "TICKET_ASSIGNED", code="ACM-1", status="Assigned", franchisee_name="x"
    ) == (
        "ACM-1 already has a technician, so it can't move to another franchisee. "
        "Cancel it from the technician first, or re-assign it."
    )
    assert fh.blocker_message(
        "TICKET_NOT_ASSIGNABLE", code="ACM-1", status="Closed", franchisee_name="x"
    ) == "This ticket is Closed and can no longer be moved."
    assert fh.blocker_message(
        "SAME_FRANCHISEE", code="ACM-1", status="New", franchisee_name="SkyFix Services"
    ) == "ACM-1 already belongs to SkyFix Services. Choose a different franchisee."
    assert fh.blocker_message(
        "FRANCHISEE_INACTIVE", code="ACM-1", status="New", franchisee_name="Acme Secunderabad"
    ) == "Acme Secunderabad is switched off and can't be given work. Choose another franchisee."


# ── option_order (23-25) ────────────────────────────────────────────────────


def _o(name, eligible, online):
    return {"name": name, "eligibleTechnicians": eligible, "onlineTechnicians": online}


def test_23_eligible_desc_then_online_desc_then_name_case_insensitive():
    out = fh.option_order(
        [_o("zeta", 1, 1), _o("alpha", 3, 0), _o("Beta", 3, 2), _o("gamma", 3, 2), _o("Aardvark", 0, 0)]
    )
    assert [o["name"] for o in out] == ["Beta", "gamma", "alpha", "zeta", "Aardvark"]


def test_23b_name_tiebreak_ignores_case():
    out = fh.option_order([_o("bravo", 1, 1), _o("Alpha", 1, 1), _o("charlie", 1, 1)])
    assert [o["name"] for o in out] == ["Alpha", "bravo", "charlie"]


def test_24_equal_keys_are_stable():
    a, b = _o("same", 1, 1), _o("SAME", 1, 1)
    assert fh.option_order([a, b]) == [a, b]
    assert fh.option_order([b, a]) == [b, a]


def test_25_empty_is_empty():
    assert fh.option_order([]) == []


# ── request shape: the flag is never typed by a client ──────────────────────


def test_the_request_has_no_routing_override_field():
    assert "routingOverride" not in HandToFranchiseeRequest.model_fields
    assert set(HandToFranchiseeRequest.model_fields) == {"franchiseeId", "reason"}


def test_reason_is_stripped_and_bounded_3_to_255():
    ok = HandToFranchiseeRequest(franchiseeId=uuid.uuid4(), reason="  abc  ")
    assert ok.reason == "abc"
    assert HandToFranchiseeRequest(franchiseeId=uuid.uuid4(), reason="x" * 255).reason == "x" * 255
    for bad in ("", "  ", "ab", " ab ", "x" * 256):
        with pytest.raises(Exception):
            HandToFranchiseeRequest(franchiseeId=uuid.uuid4(), reason=bad)


# ── the route wiring: every guard is in dependencies=[...] ──────────────────


def _route(path: str, method: str):
    for r in tickets_router.routes:
        if getattr(r, "path", None) == path and method in getattr(r, "methods", set()):
            return r
    raise AssertionError(f"no {method} {path}")


def _guards(route) -> list[str]:
    return [d.dependency.__qualname__ for d in route.dependencies]


EXPECTED = [
    "require_feature.<locals>._guard",  # jobs.assign
    "require_min_rank.<locals>._guard",  # the Area-Manager floor
    "require_staff_principal",
]


def test_options_route_carries_all_three_guards():
    assert _guards(_route("/tickets/{ticket_id}/franchisee-options", "GET")) == EXPECTED


def test_hand_over_route_carries_all_three_guards():
    assert _guards(_route("/tickets/{ticket_id}/franchisee", "POST")) == EXPECTED


def test_the_guards_are_jobs_assign_and_the_area_manager_floor():
    # Not just "some feature": the closure carries the key and the floor.
    route = _route("/tickets/{ticket_id}/franchisee", "POST")
    feature, rank, _staff = [d.dependency for d in route.dependencies]
    cells = {c.cell_contents for c in (feature.__closure__ or ())}
    assert "jobs.assign" in cells
    assert any(isinstance(c, int) for c in {c.cell_contents for c in (rank.__closure__ or ())})
