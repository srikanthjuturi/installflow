"""`app.features.tickets.integration_tracking` — the allow-list and the pure helpers."""

import datetime
import re
import uuid

import pytest

from app.core.errors import AppError
from app.features.tickets.integration_tracking import (
    IST,
    MAX_LIMIT,
    TIMELINE_TITLES,
    decode_cursor,
    encode_cursor,
    parse_since,
)
from app.models.ticket_event import EVENT_KINDS

#: History a CRM must never read about: money, the franchisee, parts, a
#: technician's own record, messages we sent, and bookkeeping.
FORBIDDEN_KINDS = {
    "bonus_added",
    "penalty_reversed",
    "speed_settled",
    "franchisee_changed",
    "part_requested",
    "part_approved",
    "part_rejected",
    "part_issued",
    "part_returned",
    "no_show",
    "released",
    "escalated",
    "serial_mismatch",
    "serial_corrected",
    "confirmation_sent",
    "customer_notified",
    "reminded",
    "status_changed",
    "location_set",
}


def test_every_listed_kind_is_a_real_event_kind() -> None:
    assert set(TIMELINE_TITLES) <= set(EVENT_KINDS)


def test_no_forbidden_kind_is_sent() -> None:
    assert not (set(TIMELINE_TITLES) & FORBIDDEN_KINDS)


def test_titles_are_plain_words_with_no_numbers_or_money() -> None:
    for title in TIMELINE_TITLES.values():
        assert not re.search(r"\d", title), title
        assert "₹" not in title and "+91" not in title
        assert len(title) < 60


def test_cursor_round_trips() -> None:
    at = datetime.datetime(2026, 11, 5, 9, 30, tzinfo=IST)
    ident = uuid.uuid4()
    got_at, got_id = decode_cursor(encode_cursor(at, ident))
    assert got_at == at and got_id == ident


def test_a_made_up_cursor_is_a_validation_error() -> None:
    for bad in ("", "abc", "bm90LWEtY3Vyc29y"):
        with pytest.raises(AppError) as err:
            decode_cursor(bad)
        assert err.value.code == "VALIDATION_ERROR"


def test_since_without_an_offset_is_read_as_ist() -> None:
    got = parse_since("2026-11-05T10:00:00")
    assert got.utcoffset() == datetime.timedelta(hours=5, minutes=30)
    assert parse_since("2026-11-05T04:30:00Z") == parse_since("2026-11-05T10:00:00+05:30")


def test_since_that_is_not_a_time_is_a_validation_error() -> None:
    with pytest.raises(AppError) as err:
        parse_since("yesterday")
    assert err.value.code == "VALIDATION_ERROR"


def test_page_size_ceiling() -> None:
    assert MAX_LIMIT == 200
