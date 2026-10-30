"""`app.core.slots.manual_slot_allowed` and its caller,
`app.features.tickets.service.check_slot_bookable`.

Pure: neither function touches a session, so this never hits the X1 wall
(`test_no_db_guard.py`). `T()` mirrors `test_speed.py`'s own helper — an ISO
stamp read as IST, the one zone every stored instant is read in here.

`NOW` is a fixed Monday morning so every case below is deterministic:

    SLOT_LEAD_MINUTES = 90  ->  earliest = 2026-11-02 09:30 IST
    sla_due_at (24h)        =  2026-11-03 08:00 IST

Each manual-rule case is built to fail (or pass) exactly ONE rule at a time —
see the comment on each — so a case failing for the wrong reason cannot read
as green.
"""

import datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.core.slots import IST, manual_slot_allowed
from app.core.tickets import MANUAL_SLOT_MIN_MINUTES, SLOT_LEAD_MINUTES
from app.features.tickets.service import check_slot_bookable


def T(s: str) -> datetime.datetime:
    """An ISO instant in IST, the wall clock the whole product reasons in."""
    return datetime.datetime.fromisoformat(s).replace(tzinfo=IST)


NOW = T("2026-11-02T08:00:00")  # a Monday
SLA_DUE_AT = T("2026-11-03T08:00:00")  # 24h service level


def _row(slot_start=None, slot_end=None, sla_due_at=SLA_DUE_AT, service_level_hours=24):
    """A duck-typed `Ticket` carrying only what these two functions read."""
    return SimpleNamespace(
        slot_start=slot_start,
        slot_end=slot_end,
        sla_due_at=sla_due_at,
        service_level_hours=service_level_hours,
    )


# ── manual_slot_allowed ───────────────────────────────────────────────────────


def test_manual_slot_valid_off_grid_window_is_allowed() -> None:
    # 10:00-11:00 matches none of SLOT_WINDOWS's hour pairs, is exactly the
    # MANUAL_SLOT_MIN_MINUTES floor wide, and sits well inside every bound.
    row = _row()
    start, end = T("2026-11-02T10:00:00"), T("2026-11-02T11:00:00")
    assert manual_slot_allowed(row, start, end, now=NOW) is True


def test_manual_slot_too_short_is_rejected() -> None:
    # 30 minutes, under MANUAL_SLOT_MIN_MINUTES (60). Every other rule passes.
    row = _row()
    start, end = T("2026-11-02T10:00:00"), T("2026-11-02T10:30:00")
    assert end - start < datetime.timedelta(minutes=MANUAL_SLOT_MIN_MINUTES)
    assert manual_slot_allowed(row, start, end, now=NOW) is False


def test_manual_slot_before_lead_time_is_rejected() -> None:
    # earliest = NOW + 90min = 09:30. This starts at 09:00 — inside the
    # dispatch lead — while width, far bound and working hours all pass.
    row = _row()
    start, end = T("2026-11-02T09:00:00"), T("2026-11-02T10:00:00")
    earliest = NOW + datetime.timedelta(minutes=SLOT_LEAD_MINUTES)
    assert start < earliest
    assert manual_slot_allowed(row, start, end, now=NOW) is False


def test_manual_slot_past_sla_due_at_is_rejected() -> None:
    # sla_due_at is 2026-11-03 08:00. This ends at 08:30 the same day —
    # past the deadline — while every other rule passes.
    row = _row()
    start, end = T("2026-11-03T07:30:00"), T("2026-11-03T08:30:00")
    assert end > row.sla_due_at
    assert manual_slot_allowed(row, start, end, now=NOW) is False


def test_manual_slot_before_working_hours_is_rejected() -> None:
    # The grid's day opens at SLOT_WINDOWS[0][0] = 5 AM. This starts at 4 AM
    # the next day — after the lead, before the deadline, 60 minutes wide.
    row = _row()
    start, end = T("2026-11-03T04:00:00"), T("2026-11-03T05:00:00")
    assert manual_slot_allowed(row, start, end, now=NOW) is False


def test_manual_slot_after_working_hours_is_rejected() -> None:
    # The grid's day closes at SLOT_WINDOWS[-1][1] = 9 PM. This ends at 9:30
    # PM the same day — after the lead, before the deadline, 60 minutes wide.
    row = _row()
    start, end = T("2026-11-02T20:30:00"), T("2026-11-02T21:30:00")
    assert manual_slot_allowed(row, start, end, now=NOW) is False


def test_manual_slot_spanning_midnight_is_rejected() -> None:
    # Both clock times (8 PM, 6 AM) individually sit inside 5 AM-9 PM, so only
    # the same-calendar-day rule catches this — a window that is actually a
    # day and ten hours wide, not one visit.
    row = _row()
    start, end = T("2026-11-02T20:00:00"), T("2026-11-03T06:00:00")
    assert start.astimezone(IST).time() >= datetime.time(5, 0)
    assert end.astimezone(IST).time() <= datetime.time(21, 0)
    assert manual_slot_allowed(row, start, end, now=NOW) is False


def test_manual_slot_rejects_end_before_or_equal_start() -> None:
    # Defensive re-check — a pure function must not trust a caller's ordering.
    row = _row()
    start = T("2026-11-02T11:00:00")
    assert manual_slot_allowed(row, start, start, now=NOW) is False
    assert manual_slot_allowed(row, start, start - datetime.timedelta(minutes=30), now=NOW) is False


# ── check_slot_bookable ───────────────────────────────────────────────────────


def test_check_slot_bookable_accepts_an_exact_grid_slot() -> None:
    # 13:00-15:00 IST is one of SLOT_WINDOWS's own pairs and falls inside the
    # 24h service level from NOW — the common case, unaffected by the manual
    # fallback existing at all.
    row = _row(slot_start=T("2026-11-02T13:00:00"), slot_end=T("2026-11-02T15:00:00"))
    check_slot_bookable(row, now=NOW)  # must not raise


def test_check_slot_bookable_accepts_a_manual_off_grid_slot() -> None:
    # 14:00-15:00 IST matches none of SLOT_WINDOWS's pairs and would have
    # been refused before this change. It satisfies every manual rule, so it
    # is accepted now.
    row = _row(slot_start=T("2026-11-02T14:00:00"), slot_end=T("2026-11-02T15:00:00"))
    check_slot_bookable(row, now=NOW)  # must not raise


def test_check_slot_bookable_rejects_a_slot_neither_rule_allows() -> None:
    # 08:10-09:10 IST: not a grid pair, and inside the manual lead-time
    # buffer too — neither path accepts it.
    row = _row(slot_start=T("2026-11-02T08:10:00"), slot_end=T("2026-11-02T09:10:00"))
    with pytest.raises(HTTPException) as exc_info:
        check_slot_bookable(row, now=NOW)
    assert exc_info.value.status_code == 400


def test_check_slot_bookable_noop_with_no_slot() -> None:
    row = _row(slot_start=None, slot_end=None)
    check_slot_bookable(row, now=NOW)  # must not raise
