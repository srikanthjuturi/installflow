"""The speed allowance's arithmetic — the part with no database in it.

Task 11 (index §3.7). Pure, so every rule below is unit-tested directly
(`api/tests/unit/test_speed.py`); the DB halves live in `speed_rules.py`
(the matrix CRUD + the resolution query) and `speed_settle.py` (the clock
loader + the closure writer). Slices never import each other (hard rule 4)
— both of those ARE core, and this file is the arithmetic they share.

The rules, restated where they are implemented (00-index S1–S6, writer
decisions W1–W17):

  * **S2** — the ticket's MODEL row wins; else the deepest NODE row on
    `tickets.node_path_ids`; else none. Keyed on the snapshot's franchisee
    and technician type, not the live ones.
  * **S3 / R1 (owner ruling 2026-10-15)** — the clock runs from the LATER of
    the latest `assigned` event and the ticket's `slot_start`, MINUS the time
    the ticket spent `Awaiting Part`, TO the latest `completed` event. The
    slot is read from the TICKET, not from events (W17) — it is passed in as
    data, never derived.
  * **S4** — `≤ reward_within_hours` → a reward; `> penalty_after_hours` → a
    penalty; between → nothing. Compared on EXACT seconds (W4), so the
    rounding shown on a screen never decides the money.
"""

import datetime
import uuid
from dataclasses import dataclass
from typing import Literal, Sequence

#: The status that suspends the clock. A literal, not imported: works before
#: Task 12 makes it a live state, and W6 matches on the event's
#: `from_status`/`to_status` columns, whatever kind carries the move.
AWAITING_PART = "Awaiting Part"


@dataclass(frozen=True)
class SpeedTerms:
    """What `accept_snapshot.speed` holds, typed (index §3.5).

    Frozen at accept (S5): the matrix rows these four figures came from can be
    edited or deleted afterwards and this copy never moves. `rule_id` is the
    matrix row's id FOR INFORMATION ONLY — the terms are what is judged,
    never the row's current contents (W2 allows a row which has since been
    zeroed or deleted to have stamped a live job).
    """

    rule_id: uuid.UUID | None
    matched_on: Literal["model", "node"]
    matched_id: uuid.UUID
    reward_within_hours: int
    penalty_after_hours: int
    reward_paise: int
    penalty_paise: int


@dataclass(frozen=True)
class EventFact:
    """One `ticket_events` row, reduced to what the clock reads (W6).

    The caller (`speed_settle.load_clock`) already filtered the rows to the
    two kinds of instant plus the Awaiting-Part moves; the clock needs only
    these five fields, and `at` is the event's `created_at` — the
    transaction's `now()`, which is when the accept and the completion
    actually happened.
    """

    seq: int
    kind: str
    at: datetime.datetime                  # tz-aware
    from_status: str | None
    to_status: str | None


@dataclass(frozen=True)
class SpeedClock:
    """The measurement: where the clock started, where it stopped, and what
    the technician was paid for the gap between. Everything a `speed_settled`
    event's note and the ticket detail's `speed` block both want to say."""

    #: The accept — the latest `assigned` before the completion (W5).
    assigned_at: datetime.datetime
    #: The slot in force at completion (R1); None = no slot.
    slot_start: datetime.datetime | None
    #: max(assigned_at, slot_start) — the instant the hours run from (R1).
    clock_start: datetime.datetime
    completed_at: datetime.datetime
    #: The raw Awaiting-Part intervals the clock read off, each (enter, exit)
    #: with exit None when still open — carried for the note, not for money
    #: (money subtracts the MERGED, clipped hours below).
    part_wait_intervals: tuple[tuple[datetime.datetime, datetime.datetime | None], ...]
    elapsed_hours: float          # clock_start → completed_at, exact
    part_wait_hours: float        # the intervals' merged, clipped union
    working_hours: float          # elapsed − part_wait


def clock_start(
    assigned_at: datetime.datetime, slot_start: datetime.datetime | None
) -> datetime.datetime:
    """R1 (owner ruling 2026-10-15). The LATER of the accept and the slot's
    start; the accept alone when there is no slot (`slot_start is None`).

    Pure and total — the one place the rule lives. Naive datetimes raise
    `ValueError`: every stored instant is UTC (hard rule 11), so an instant
    without a zone here means a caller mixed clocks and cannot be trusted.
    """
    if assigned_at.tzinfo is None or (
        slot_start is not None and slot_start.tzinfo is None
    ):
        raise ValueError("clock_start needs timezone-aware datetimes")
    return slot_start if slot_start is not None and slot_start > assigned_at else assigned_at


def _merge(
    intervals: Sequence[tuple[datetime.datetime, datetime.datetime | None]]
) -> list[tuple[datetime.datetime, datetime.datetime]]:
    """Sort a list of `(start, end_or_None)` pairs and merge the overlaps.

    None ends run to +infinity for merging purposes — an open interval
    swallows everything after it. All instants are tz-aware (the clock's own
    guard).
    """
    ordered = sorted(
        intervals,
        key=lambda pair: (pair[0], pair[1] or datetime.datetime.max.replace(tzinfo=pair[0].tzinfo)),
    )
    merged: list[list[datetime.datetime]] = []
    for start, end in ordered:
        if merged and start <= merged[-1][1]:
            open_end = end or datetime.datetime.max.replace(tzinfo=start.tzinfo)
            if open_end > merged[-1][1]:
                merged[-1][1] = open_end
        else:
            open_end = end or datetime.datetime.max.replace(tzinfo=start.tzinfo)
            merged.append([start, open_end])
    return merged


def working_hours(
    clock_start_at: datetime.datetime,
    completed_at: datetime.datetime,
    part_wait_intervals: Sequence[tuple[datetime.datetime, datetime.datetime | None]],
) -> float:
    """Hours from `clock_start` to `completed_at` MINUS the union of the
    part-wait intervals, each clipped to [clock_start, completed_at].

    An interval with end None runs to `completed_at` — the Awaiting Part
    move's exit is the completion itself when the part arrived with the work.
    Overlaps merge, order does not matter, and intervals outside the window —
    including every interval that ended BEFORE the clock start (R1: the days
    a technician waited for the slot are nobody's wait) — contribute nothing.

    `completed_at <= clock_start` → 0.0: the clamp for a slot that begins
    after the technician finished (R1) — early is never negative, and S4
    reads 0.0 as a reward.

    Naive datetimes raise `ValueError` (hard rule 11). Exact: seconds/3600 —
    never rounded on the way here, because the outcome's comparisons see the
    unrounded figure (W4).
    """
    if clock_start_at.tzinfo is None or completed_at.tzinfo is None:
        raise ValueError("working_hours needs timezone-aware datetimes")

    if completed_at <= clock_start_at:
        return 0.0

    window = (completed_at - clock_start_at).total_seconds()
    return (window - _waited_seconds(clock_start_at, completed_at, part_wait_intervals)) / 3600


def _waited_seconds(
    start: datetime.datetime,
    end: datetime.datetime,
    part_wait_intervals: Sequence[tuple[datetime.datetime, datetime.datetime | None]],
) -> float:
    """Seconds the merged, clipped UNION of `intervals` covers inside
    [start, end]. The half `working_hours` subtracts, carried separately —
    the note quotes BOTH figures ("23.0 working hours · 3.0 h waiting for
    parts"), so `clock_from_events` needs them apart rather than only their
    difference. Same clipping as `working_hours` (see there)."""
    waited = 0.0
    for a, b in _merge(list(part_wait_intervals)):
        a = max(a, start)
        b = min(b or end, end)
        waited += max(0.0, (b - a).total_seconds())
    return waited


def clock_from_events(
    events: Sequence[EventFact],
    slot_start: datetime.datetime | None = None,
) -> SpeedClock | None:
    """S3 / W5 / W6 / W17. Find the LATEST `completed` (by `seq`) and the
    latest `assigned` with a smaller `seq`; None if either is missing.

    A customer-refused job that is re-assigned (and completed again) is
    measured from its RE-assignment — or its slot, when the slot is the later
    half (R1). A completion with no `assigned` before it — a force-close's
    shape, or a ticket from before the accept flow — is "not measurable" and
    pays nothing: the `SpeedClock` is not even built.

    `slot_start` is the ticket's slot in force at completion (None = none) —
    data, not an event: clocks run from `clock_start(assigned_at, slot_start)`.

    Between `assigned` and `completed` (by `seq`), an event whose
    `to_status` is `Awaiting Part` opens a wait and one whose `from_status`
    is `Awaiting Part` closes the open interval. A close with nothing open is
    ignored; an open with nothing closing it stays open-ended and runs to
    `completed_at`. W6: the status columns are what identifies the move,
    whatever event `kind` carries it — Task 12 may write `part_requested`
    and today writes `status_changed`, and both subtract nothing here before
    Task 12 exists. Intervals before the latest `assigned` belong to a
    previous holder and are clipped away by the strict `seq` ordering.

    Naive instants raise `ValueError`, through `clock_start`/`working_hours`.
    """
    events = list(events)
    if any(e.at.tzinfo is None for e in events):
        raise ValueError("clock_from_events needs timezone-aware events")

    completed = max(
        (e for e in events if e.kind == "completed"),
        key=lambda e: e.seq,
        default=None,
    )
    if completed is None:
        return None
    assigned = max(
        (e for e in events if e.kind == "assigned" and e.seq < completed.seq),
        key=lambda e: e.seq,
        default=None,
    )
    if assigned is None:
        return None

    between = [e for e in events if assigned.seq < e.seq < completed.seq]
    intervals: list[tuple[datetime.datetime, datetime.datetime | None]] = []
    open_from: datetime.datetime | None = None
    for e in between:
        if e.to_status == AWAITING_PART and open_from is None:
            open_from = e.at
        elif e.from_status == AWAITING_PART and open_from is not None:
            intervals.append((open_from, e.at))
            open_from = None
    if open_from is not None:
        # Still in Awaiting Part when completion was recorded: the wait ran
        # up to completion — which `working_hours` clips to, exactly right.
        intervals.append((open_from, None))

    start = clock_start(assigned.at, slot_start)
    # `working_hours` returns the SUBTRACTED figure — working is exactly
    # `elapsed − part_wait` by construction, including the R1 clamp:
    # completion before the clock start is 0.0 working hours and 0.0 waited
    # (an open interval is clipped to an empty window), never negative.
    return SpeedClock(
        assigned_at=assigned.at,
        slot_start=slot_start,
        clock_start=start,
        completed_at=completed.at,
        part_wait_intervals=tuple(intervals),
        # Clamped like the working hours are: a slot starting after the
        # completion would otherwise carry a NEGATIVE "hours since" on the
        # wire, and the clamp is R1's own ("never negative").
        elapsed_hours=max(0.0, (completed.at - start).total_seconds() / 3600),
        part_wait_hours=_waited_seconds(start, completed.at, intervals) / 3600,
        working_hours=working_hours(start, completed.at, intervals),
    )


def speed_outcome(
    duration_h: float, rule: SpeedTerms
) -> tuple[Literal["reward", "penalty"] | None, int]:
    """S4. `duration_h <= reward_within_hours` → ("reward", reward_paise);
    `duration_h > penalty_after_hours` → ("penalty", penalty_paise); in
    between → (None, 0).

    Compared on the UNROUNDED duration (W4): 12 h 0 min 1 s is not ≤ 12. A
    zero amount is returned as-is — the outcome is still named so the
    `speed_settled` event can record what the rule SAID, and the caller
    writes no ledger row for 0 (W2: `amount_paise > 0` is a table-level
    CHECK, and "the absence of a movement is spelled 'no row'").

    Equal thresholds (12/12) leave no neutral band, exactly as S4 reads: 12.0
    is a reward, 12 h + 1 s is a penalty.
    """
    if duration_h <= rule.reward_within_hours:
        return "reward", rule.reward_paise
    if duration_h > rule.penalty_after_hours:
        return "penalty", rule.penalty_paise
    return None, 0


def resolve_speed_rule(
    candidates,
    *,
    model_id: uuid.UUID,
    node_path_ids: Sequence[uuid.UUID],
) -> tuple[object, Literal["model", "node"]] | None:
    """S2, the pure half. `candidates` are rule rows already filtered to
    (franchisee, technician_type) AND to `model_id == model_id OR node_id in
    node_path_ids` — `speed_rules.candidate_rules` does the SQL half.

    A MODEL row wins. Else the NODE row whose `node_id` sits LATEST in
    `node_path_ids` (`ancestor_ids`' order is root-first, so latest =
    deepest). An empty list — no rule configured (W1) — returns None, and so
    does a candidate for a model other than the ticket's or a node off the
    path (which SQL should never have returned; ignored rather than trusted).

    Returns `(row, "model" | "node")` or None. The row is returned raw — the
    STAMPER turns it into a `SpeedTerms`, freezing its figures, because rows
    are SQLAlchemy objects here and not typed data.
    """
    path = list(node_path_ids)
    nodes = {r.node_id: i for i, r in enumerate(
        sorted(
            (r for r in candidates if r.model_id is None and r.node_id in path),
            key=lambda r: path.index(r.node_id),   # root's index is 0 = shallowest
        )
    )}
    model_row = next((r for r in candidates if r.model_id == model_id), None)
    if model_row is not None:
        return model_row, "model"
    best = None
    best_index = -1
    for node_id, index in nodes.items():
        if index > best_index:
            best_index = index
            best = node_id
    if best is None:
        return None
    return next(r for r in candidates if r.model_id is None and r.node_id == best), "node"


def hours_label(h: float) -> str:
    """`23.0` — the one-decimal figure every speed display and note carries."""
    return f"{h:.1f}"