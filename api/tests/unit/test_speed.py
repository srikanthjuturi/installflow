"""`app.core.speed` — the speed allowance's arithmetic (11 §6, cases 1–44).

Pure: the module imports no session and builds no row, so this file never
touches the X1 wall. Every case number sits in a comment naming its row in the
doc's table; the R1 ruling's cases (36–44) run through the same factories so a
change in one shows up in all.

Two helpers, exactly the ones §6 names: `T` (an ISO stamp in IST, the one zone
every stored instant is read in) and `terms()` (a frozen SpeedTerms with the
spec's own worked figures — reward ₹200 within 12 h, penalty ₹150 after 24 h).
"""

import datetime
import uuid
from types import SimpleNamespace

import pytest

from app.core.accept_snapshot import speed_of
from app.core.ledger import cap_remaining, capped_charge
from app.core.slots import IST
from app.core.speed import (
    EventFact,
    SpeedTerms,
    clock_from_events,
    clock_start,
    resolve_speed_rule,
    speed_outcome,
    working_hours,
)

#: 2026-10-12 is a Monday. Every stamp below is one of that week's days.
MON = "2026-10-12"
TUE = "2026-10-13"
WED = "2026-10-14"
THU = "2026-10-15"
FRI = "2026-10-16"


def T(s: str) -> datetime.datetime:
    """An ISO instant in IST, the wall clock the whole product reasons in."""
    return datetime.datetime.fromisoformat(s).replace(tzinfo=IST)


def terms(
    reward_hours: int = 12,
    penalty_hours: int = 24,
    reward_paise: int = 20000,
    penalty_paise: int = 15000,
) -> SpeedTerms:
    """§'s frozen copy: rule_id None (the row it came from is for information),
    matched on a product, matched_id an id nobody reads in these cases."""
    return SpeedTerms(
        rule_id=None,
        matched_on="model",
        matched_id=uuid.uuid4(),
        reward_within_hours=reward_hours,
        penalty_after_hours=penalty_hours,
        reward_paise=reward_paise,
        penalty_paise=penalty_paise,
    )


def ev(
    seq: int,
    kind: str,
    at: datetime.datetime,
    from_status: str | None = None,
    to_status: str | None = None,
) -> EventFact:
    """One `ticket_events` row reduced to the clock's five fields (W6)."""
    return EventFact(seq=seq, kind=kind, at=at, from_status=from_status,
                     to_status=to_status)


# ── speed_outcome (S4) ──────────────────────────────────────────────────────


def test_outcome_reward_at_and_before_threshold() -> None:      # test 1
    assert speed_outcome(12.0, terms()) == ("reward", 20000)
    assert speed_outcome(0.0, terms()) == ("reward", 20000)


def test_outcome_one_second_past_the_reward_band_is_neutral() -> None:   # test 2
    assert speed_outcome(12 + 1 / 3600, terms()) == (None, 0)


def test_outcome_penalty_begins_one_second_past_24() -> None:   # test 3
    assert speed_outcome(24.0, terms()) == (None, 0)
    assert speed_outcome(24 + 1 / 3600, terms()) == ("penalty", 15000)


def test_outcome_equal_thresholds_leave_no_neutral_band() -> None:   # test 4
    t = terms(reward_hours=12, penalty_hours=12)
    assert speed_outcome(12.0, t) == ("reward", 20000)
    assert speed_outcome(12 + 1 / 3600, t) == ("penalty", 15000)


def test_outcome_zero_amounts_name_the_outcome_with_zero() -> None:   # test 5
    # A ₹0 reward is still "fast enough" — the outcome is named so the
    # `speed_settled` event can record what the rule SAID (W2).
    assert speed_outcome(5.0, terms(reward_paise=0)) == ("reward", 0)
    assert speed_outcome(30.0, terms(penalty_paise=0)) == ("penalty", 0)
    assert speed_outcome(30.0, terms(reward_paise=0, penalty_paise=0)) == (
        "penalty",
        0,
    )
    assert speed_outcome(5.0, terms(reward_paise=0, penalty_paise=0)) == (
        "reward",
        0,
    )


# ── working_hours (S3, W6, R1's clamp) ──────────────────────────────────────


def test_worked_example_26_and_23() -> None:                    # test 6
    a = T(f"{MON} 11:00")
    c = T(f"{TUE} 13:00")
    assert working_hours(a, c, []) == 26.0
    assert working_hours(a, c, [(T(f"{MON} 15:00"), T(f"{MON} 18:00"))]) == 23.0


def test_overlapping_intervals_merge_to_one_subtraction() -> None:   # test 7
    a = T(f"{MON} 11:00")
    c = T(f"{MON} 23:00")
    got = working_hours(
        a, c,
        [(T(f"{MON} 13:00"), T(f"{MON} 16:00")), (T(f"{MON} 15:00"), T(f"{MON} 18:00"))],
    )
    assert got == 7.0      # 12 h elapsed − 5 h merged


def test_interval_order_does_not_matter() -> None:              # test 8
    a = T(f"{MON} 11:00")
    c = T(f"{MON} 23:00")
    assert working_hours(
        a, c,
        [(T(f"{MON} 15:00"), T(f"{MON} 18:00")), (T(f"{MON} 13:00"), T(f"{MON} 16:00"))],
    ) == 7.0


def test_nested_intervals_subtract_the_outer_one() -> None:     # test 9
    a = T(f"{MON} 11:00")
    c = T(f"{MON} 23:00")
    assert working_hours(
        a, c,
        [(T(f"{MON} 13:00"), T(f"{MON} 18:00")), (T(f"{MON} 14:00"), T(f"{MON} 15:00"))],
    ) == 7.0


def test_open_ended_wait_runs_to_completion() -> None:          # test 10
    a = T(f"{MON} 11:00")
    c = T(f"{TUE} 13:00")
    assert working_hours(a, c, [(T(f"{TUE} 10:00"), None)]) == 23.0


def test_intervals_outside_the_window_subtract_nothing() -> None:   # test 11
    a = T(f"{MON} 11:00")
    c = T(f"{TUE} 13:00")
    assert working_hours(a, c, [(T(f"{MON} 08:00"), T(f"{MON} 09:00"))]) == 26.0
    assert working_hours(a, c, [(T(f"{TUE} 15:00"), T(f"{TUE} 18:00"))]) == 26.0


def test_intervals_straddling_either_edge_are_clipped() -> None:   # test 12
    a = T(f"{MON} 11:00")
    c = T(f"{TUE} 13:00")
    assert working_hours(a, c, [(T(f"{MON} 09:00"), T(f"{MON} 12:00"))]) == 25.0
    assert working_hours(a, c, [(T(f"{TUE} 12:00"), T(f"{TUE} 15:00"))]) == 25.0


def test_a_wait_covering_everything_leaves_zero_and_a_zero_length_is_free() -> None:  # test 13
    a = T(f"{MON} 11:00")
    c = T(f"{TUE} 13:00")
    assert working_hours(a, c, [(T(f"{MON} 09:00"), T(f"{TUE} 18:00"))]) == 0.0
    assert working_hours(a, c, [(T(f"{MON} 12:00"), T(f"{MON} 12:00"))]) == 26.0


def test_completion_before_the_start_clamps_to_zero() -> None:   # test 14
    a = T(f"{MON} 11:00")
    assert working_hours(a, T(f"{MON} 09:00"), []) == 0.0


def test_naive_datetimes_are_refused() -> None:                 # test 15
    naive_a = datetime.datetime.fromisoformat(f"{MON} 11:00")
    naive_c = datetime.datetime.fromisoformat(f"{TUE} 13:00")
    with pytest.raises(ValueError):
        working_hours(naive_a, T(f"{TUE} 13:00"), [])
    with pytest.raises(ValueError):
        working_hours(T(f"{MON} 11:00"), naive_c, [])


def test_exact_seconds_survive_without_a_float_drift() -> None:  # test 16
    a = T(f"{MON} 00:00:00")
    c = T(f"{MON} 12:00:00")
    assert working_hours(a, c, []) == 12.0      # ==, not ≈ (W4)


# ── clock_from_events (W5, W6) ──────────────────────────────────────────────


def test_plain_accept_then_complete_pair() -> None:             # test 17
    clock = clock_from_events([
        ev(1, "assigned", T(f"{MON} 11:00")),
        ev(5, "completed", T(f"{TUE} 13:00")),
    ])
    assert clock is not None
    assert clock.assigned_at == T(f"{MON} 11:00")
    assert clock.completed_at == T(f"{TUE} 13:00")
    assert clock.clock_start == T(f"{MON} 11:00")
    assert clock.working_hours == 26.0


def test_reassignment_resets_the_clock() -> None:               # test 18
    clock = clock_from_events([
        ev(1, "assigned", T(f"{MON} 11:00")),
        ev(2, "released", T(f"{MON} 12:00")),
        ev(3, "assigned", T(f"{TUE} 12:00")),
        ev(6, "completed", T(f"{TUE} 13:00")),
    ])
    assert clock is not None
    assert clock.assigned_at == T(f"{TUE} 12:00")   # seq 3, not 1
    assert clock.working_hours == 1.0


def test_a_reschedule_event_does_not_reset_the_clock() -> None:  # test 19
    clock = clock_from_events([
        ev(1, "assigned", T(f"{MON} 11:00")),
        ev(2, "rescheduled", T(f"{MON} 12:00")),
        ev(4, "completed", T(f"{TUE} 13:00")),
    ])
    assert clock is not None
    assert clock.assigned_at == T(f"{MON} 11:00")   # the accept stands
    assert clock.working_hours == 26.0


def test_a_re_completion_is_measured_from_the_re_assignment() -> None:  # test 20
    clock = clock_from_events([
        ev(1, "assigned", T(f"{MON} 11:00")),
        ev(3, "completed", T(f"{MON} 13:00")),
        ev(4, "reopened", T(f"{TUE} 06:00")),
        ev(5, "assigned", T(f"{TUE} 07:00")),
        ev(8, "completed", T(f"{TUE} 13:00")),
    ])
    assert clock is not None
    assert clock.assigned_at == T(f"{TUE} 07:00")   # seq 5 → 8
    assert clock.working_hours == 6.0


def test_no_completed_or_earlier_assigned_is_not_measurable() -> None:  # test 21
    assert clock_from_events([]) is None
    # A force-close's shape: a `completed` with no `assigned` before it.
    assert clock_from_events([
        ev(5, "assigned", T(f"{TUE} 07:00")),
        ev(3, "completed", T(f"{MON} 13:00")),
    ]) is None
    assert clock_from_events([ev(3, "completed", T(f"{MON} 13:00"))]) is None


def test_awaiting_part_read_off_the_status_columns() -> None:   # test 22
    clock = clock_from_events([
        ev(1, "assigned", T(f"{MON} 11:00")),
        ev(3, "status_changed", T(f"{MON} 13:00"), to_status="Awaiting Part"),
        ev(4, "status_changed", T(f"{MON} 16:00"), from_status="Awaiting Part"),
        ev(5, "completed", T(f"{MON} 23:00")),
    ])
    assert clock is not None
    assert clock.part_wait_hours == 3.0
    assert clock.working_hours == 9.0


def test_part_requested_kind_writes_the_same_interval() -> None:  # test 23
    clock = clock_from_events([
        ev(1, "assigned", T(f"{MON} 11:00")),
        ev(3, "part_requested", T(f"{MON} 13:00"), to_status="Awaiting Part"),
        ev(4, "status_changed", T(f"{MON} 16:00"), from_status="Awaiting Part"),
        ev(5, "completed", T(f"{MON} 23:00")),
    ])
    assert clock is not None
    assert clock.part_wait_hours == 3.0     # W6: the kind carries nothing


def test_two_waits_two_intervals_one_sided_moves_behave() -> None:  # test 24
    two = clock_from_events([
        ev(1, "assigned", T(f"{MON} 11:00")),
        ev(2, "status_changed", T(f"{MON} 13:00"), to_status="Awaiting Part"),
        ev(3, "status_changed", T(f"{MON} 14:00"), from_status="Awaiting Part"),
        ev(4, "status_changed", T(f"{MON} 15:00"), to_status="Awaiting Part"),
        ev(5, "status_changed", T(f"{MON} 16:00"), from_status="Awaiting Part"),
        ev(6, "completed", T(f"{MON} 23:00")),
    ])
    assert two is not None
    assert two.part_wait_intervals == (
        (T(f"{MON} 13:00"), T(f"{MON} 14:00")),
        (T(f"{MON} 15:00"), T(f"{MON} 16:00")),
    )
    assert two.part_wait_hours == 2.0
    assert two.working_hours == 10.0

    # An exit with nothing open is ignored (W6) — the clock does not invent a
    # wait that started before the technician ever held the job.
    lonely_exit = clock_from_events([
        ev(1, "assigned", T(f"{MON} 11:00")),
        ev(2, "status_changed", T(f"{MON} 13:00"), from_status="Awaiting Part"),
        ev(6, "completed", T(f"{MON} 23:00")),
    ])
    assert lonely_exit is not None
    assert lonely_exit.part_wait_hours == 0.0
    assert lonely_exit.working_hours == 12.0

    # An entry with no exit is open-ended: the wait ran up to the completion —
    # which is exactly what the None end clips to.
    open_ended = clock_from_events([
        ev(1, "assigned", T(f"{MON} 11:00")),
        ev(2, "status_changed", T(f"{MON} 13:00"), to_status="Awaiting Part"),
        ev(6, "completed", T(f"{MON} 23:00")),
    ])
    assert open_ended is not None
    assert open_ended.part_wait_hours == 10.0
    assert open_ended.working_hours == 2.0


def test_waits_from_the_previous_holder_are_clipped_away() -> None:  # test 25
    clock = clock_from_events([
        ev(1, "assigned", T(f"{MON} 11:00")),
        ev(2, "status_changed", T(f"{MON} 13:00"), to_status="Awaiting Part"),
        ev(3, "status_changed", T(f"{MON} 16:00"), from_status="Awaiting Part"),
        ev(5, "assigned", T(f"{TUE} 07:00")),
        ev(8, "completed", T(f"{TUE} 13:00")),
    ])
    assert clock is not None
    assert clock.assigned_at == T(f"{TUE} 07:00")
    assert clock.part_wait_hours == 0.0     # strictly between seq 5 and 8: none
    assert clock.working_hours == 6.0


def test_no_waiting_part_events_means_zero_wait() -> None:      # test 26
    clock = clock_from_events([
        ev(1, "assigned", T(f"{MON} 11:00")),
        ev(5, "completed", T(f"{TUE} 13:00")),
    ])
    assert clock is not None
    assert clock.part_wait_hours == 0.0


# ── resolve_speed_rule (S2) ─────────────────────────────────────────────────


def _row(
    *, model_id: uuid.UUID | None = None, node_id: uuid.UUID | None = None
) -> object:
    return SimpleNamespace(
        model_id=model_id, node_id=node_id,
        reward_within_hours=1, penalty_after_hours=2,
        reward_paise=1, penalty_paise=2,
    )


def test_model_row_wins_over_node_rows() -> None:              # test 27
    model = uuid.uuid4()
    root = uuid.uuid4()
    leaf = uuid.uuid4()
    pick = resolve_speed_rule(
        [_row(node_id=root), _row(model_id=model), _row(node_id=leaf)],
        model_id=model, node_path_ids=[root, leaf],
    )
    assert pick is not None and pick[1] == "model"
    assert pick[0].model_id == model


def test_deepest_node_row_wins_without_a_model_row() -> None:   # test 28
    root = uuid.uuid4()
    leaf = uuid.uuid4()
    pick = resolve_speed_rule(
        [_row(node_id=root), _row(node_id=leaf)],
        model_id=uuid.uuid4(), node_path_ids=[root, leaf],
    )
    assert pick is not None and pick[1] == "node"
    assert pick[0].node_id == leaf


def test_a_node_row_off_the_path_is_ignored() -> None:          # test 29
    root = uuid.uuid4()
    pick = resolve_speed_rule(
        [_row(node_id=uuid.uuid4())],           # not on the ticket's path
        model_id=uuid.uuid4(), node_path_ids=[root],
    )
    assert pick is None


def test_another_models_row_is_ignored() -> None:               # test 30
    root = uuid.uuid4()
    assert resolve_speed_rule(
        [_row(model_id=uuid.uuid4())],          # another model's row
        model_id=uuid.uuid4(), node_path_ids=[root],
    ) is None


def test_a_model_row_beats_nothing_when_the_path_has_no_rows() -> None:  # test 30b
    model = uuid.uuid4()
    pick = resolve_speed_rule(
        [_row(model_id=model), _row(node_id=uuid.uuid4())],
        model_id=model, node_path_ids=[],
    )
    assert pick is not None and pick[1] == "model"


# ── capped_charge / cap_remaining (W8) ──────────────────────────────────────


def test_cap_zero_means_uncapped_all_the_way_through() -> None: # test 31
    assert cap_remaining(cap_paise=0, already_charged=12345) is None
    assert capped_charge(15000, None) == 15000


def test_a_partial_charge_of_what_remains() -> None:            # test 32
    remaining = cap_remaining(cap_paise=500000, already_charged=490000)
    assert remaining == 10000
    assert capped_charge(15000, remaining) == 10000


def test_nothing_left_charges_nothing() -> None:                # test 33
    remaining = cap_remaining(cap_paise=500000, already_charged=500000)
    assert remaining == 0
    assert capped_charge(15000, remaining) == 0    # 0 → "write no row" (W8)


def test_room_beyond_the_band_pays_the_whole_band() -> None:    # test 34
    remaining = cap_remaining(cap_paise=500000, already_charged=0)
    assert remaining == 500000
    assert capped_charge(15000, remaining) == 15000
    assert capped_charge(15000, 0) == 0


# ── speed_of (S5 / §3.5) ────────────────────────────────────────────────────


def _full_speed() -> dict:
    return {
        "matchedOn": "model",
        "matchedId": str(uuid.uuid4()),
        "rewardWithinHours": 12,
        "penaltyAfterHours": 24,
        "rewardPaise": 20000,
        "penaltyPaise": 15000,
    }


def test_speed_of_refuses_nothing_that_looks_like_terms() -> None:  # test 35
    assert speed_of(None) is None
    assert speed_of({}) is None
    assert speed_of({"speed": None}) is None
    broken = _full_speed()
    del broken["penaltyPaise"]
    assert speed_of({"speed": broken}) is None


def test_speed_of_reads_the_full_block() -> None:               # test 35 (second half)
    speed = _full_speed()
    terms_read = speed_of({"speed": speed})
    assert terms_read is not None
    assert terms_read.matched_on == "model"
    assert terms_read.reward_within_hours == 12
    assert terms_read.penalty_after_hours == 24
    assert terms_read.reward_paise == 20000
    assert terms_read.penalty_paise == 15000


# ── owner ruling 2026-10-15 (R1): the clock start ──────────────────────────


def test_slot_after_accept_starts_the_clock_at_the_slot() -> None:  # test 36
    clock = clock_from_events(
        [
            ev(1, "assigned", T(f"{MON} 11:00")),
            ev(5, "completed", T(f"{THU} 13:00")),
        ],
        slot_start=T(f"{THU} 10:00"),
    )
    assert clock is not None
    assert clock.clock_start == T(f"{THU} 10:00")   # the owner's example
    assert clock.working_hours == 3.0


def test_slot_before_accept_starts_the_clock_at_the_accept() -> None:  # test 37
    clock = clock_from_events(
        [
            ev(1, "assigned", T(f"{MON} 11:00")),
            ev(5, "completed", T(f"{MON} 15:00")),
        ],
        slot_start=T(f"{MON} 09:00"),
    )
    assert clock is not None
    assert clock.clock_start == T(f"{MON} 11:00")
    assert clock.working_hours == 4.0


def test_no_slot_means_the_accept_alone() -> None:              # test 38
    events = [
        ev(1, "assigned", T(f"{MON} 11:00")),
        ev(5, "completed", T(f"{TUE} 13:00")),
    ]
    clock = clock_from_events(events, slot_start=None)
    assert clock is not None
    assert clock.clock_start == T(f"{MON} 11:00")
    assert clock.working_hours == 26.0          # case 38 echoes 6's figures
    waits = clock_from_events(
        [*events, ev(2, "status_changed", T(f"{MON} 15:00"),
                     to_status="Awaiting Part"),
         ev(3, "status_changed", T(f"{MON} 18:00"),
            from_status="Awaiting Part")],
        slot_start=None,
    )
    assert waits is not None
    assert waits.working_hours == 23.0


def test_slot_equal_to_the_accept_starts_at_that_instant() -> None:  # test 39
    clock = clock_from_events(
        [
            ev(1, "assigned", T(f"{MON} 11:00")),
            ev(5, "completed", T(f"{MON} 15:00")),
        ],
        slot_start=T(f"{MON} 11:00"),
    )
    assert clock is not None
    assert clock.clock_start == T(f"{MON} 11:00")
    assert clock.working_hours == 4.0


def test_the_rescheduled_slot_in_force_is_the_one_used() -> None:  # test 40
    # The `slot_start` argument is the ticket's SLOT NOW, not the first one —
    # the caller passes the slot in force at completion (W17/R1), so the clock
    # follows it without having read any event.
    clock = clock_from_events(
        [
            ev(1, "assigned", T(f"{MON} 11:00")),
            ev(2, "rescheduled", T(f"{MON} 12:00")),
            ev(5, "completed", T(f"{FRI} 13:00")),
        ],
        slot_start=T(f"{FRI} 10:00"),
    )
    assert clock is not None
    assert clock.clock_start == T(f"{FRI} 10:00")
    assert clock.working_hours == 3.0


def test_a_slot_later_than_completion_clamps_to_zero() -> None:  # test 41
    clock = clock_from_events(
        [
            ev(1, "assigned", T(f"{MON} 11:00")),
            ev(5, "completed", T(f"{WED} 09:00")),
        ],
        slot_start=T(f"{THU} 10:00"),
    )
    assert clock is not None
    assert clock.working_hours == 0.0          # never negative
    assert clock.elapsed_hours == 0.0
    outcome, _ = speed_outcome(clock.working_hours, terms())
    assert outcome == "reward"                 # 0 ≤ reward_within_hours (S4)


def test_waits_before_the_clock_start_are_ignored() -> None:    # test 42
    slot = T(f"{THU} 10:00")
    completed = T(f"{THU} 13:00")

    def clock_with(*interval) -> tuple[float, float]:
        events = [ev(1, "assigned", T(f"{MON} 11:00"))]
        if interval:
            events.append(ev(2, "status_changed", interval[0],
                             to_status="Awaiting Part"))
            events.append(ev(3, "status_changed", interval[1],
                             from_status="Awaiting Part"))
        events.append(ev(5, "completed", completed))
        got = clock_from_events(events, slot_start=slot)
        assert got is not None
        return got.working_hours, got.part_wait_hours

    # A wait from Monday (before the slot) contributes nothing: the days a
    # technician waited for the slot are nobody's waiting-for-parts.
    assert clock_with(T(f"{MON} 15:00"), T(f"{MON} 18:00")) == (3.0, 0.0)
    # A wait Thursday, after the clock start, subtracts in full.
    assert clock_with(T(f"{THU} 11:00"), T(f"{THU} 12:00")) == (2.0, 1.0)
    # A wait straddling the slot start subtracts only the hour after it.
    assert clock_with(T(f"{WED} 20:00"), T(f"{THU} 11:00")) == (2.0, 1.0)


def test_re_assignment_after_refusal_measures_from_the_later_half() -> None:  # test 43
    events = [
        ev(1, "assigned", T(f"{MON} 11:00")),
        ev(3, "completed", T(f"{MON} 14:00")),
        ev(5, "assigned", T(f"{WED} 12:00")),
        ev(8, "completed", T(f"{WED} 15:00")),
    ]
    # The slot in force began BEFORE the re-accept: the accept is the later half.
    old_slot = clock_from_events(events, slot_start=T(f"{TUE} 10:00"))
    assert old_slot is not None
    assert old_slot.clock_start == T(f"{WED} 12:00")
    assert old_slot.working_hours == 3.0
    # The slot in force began AFTER the re-accept: the slot is the later half.
    new_slot = clock_from_events(events, slot_start=T(f"{WED} 13:00"))
    assert new_slot is not None
    assert new_slot.clock_start == T(f"{WED} 13:00")
    assert new_slot.working_hours == 2.0


def test_naive_clock_start_and_measurable_none() -> None:       # test 44
    naive = datetime.datetime.fromisoformat(f"{MON} 11:00")
    with pytest.raises(ValueError):
        clock_start(naive, T(f"{THU} 10:00"))
    with pytest.raises(ValueError):
        clock_start(T(f"{MON} 11:00"), naive)
    # A slot given and every event present but no completion: not measurable.
    no_completion = clock_from_events(
        [ev(1, "assigned", T(f"{MON} 11:00"))], slot_start=T(f"{THU} 10:00")
    )
    assert no_completion is None