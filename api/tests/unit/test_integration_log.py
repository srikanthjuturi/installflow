"""`app.core.integration_log` — the pure halves: the limit arithmetic and the redaction."""

import datetime

from app.core.integration_log import (
    CALLS_PER_MINUTE,
    is_over_limit,
    mask_phone,
    retry_after_seconds,
    summarize_ticket_request,
)

NOW = datetime.datetime(2026, 11, 5, 10, 0, 0, tzinfo=datetime.timezone.utc)


def test_sixty_calls_are_allowed_and_the_sixty_first_is_not() -> None:
    assert CALLS_PER_MINUTE == 60
    assert not is_over_limit(59)
    assert is_over_limit(60)  # 60 already made in the window: the next is refused
    assert is_over_limit(61)


def test_retry_after_is_when_the_oldest_call_leaves_the_window() -> None:
    assert retry_after_seconds(NOW - datetime.timedelta(seconds=50), NOW) == 10
    assert retry_after_seconds(NOW - datetime.timedelta(seconds=59.2), NOW) == 1
    assert retry_after_seconds(NOW, NOW) == 60


def test_retry_after_is_never_below_one_second() -> None:
    assert retry_after_seconds(NOW - datetime.timedelta(seconds=90), NOW) == 1
    assert retry_after_seconds(None, NOW) == 1


def test_phone_is_masked_to_its_last_four_digits() -> None:
    assert mask_phone("+919876543210") == "+91XXXXXX3210"
    assert mask_phone("9876543210") == "+91XXXXXX3210"
    assert mask_phone("") is None and mask_phone(None) is None


def test_summary_drops_personal_details() -> None:
    summary = summarize_ticket_request(
        {
            "reference": "CRM-1",
            "sku": "WP-100",
            "serialNumber": "S1",
            "serviceType": "Service",
            "expectedDate": "2026-11-10",
            "pincode": "500081",
            "city": "Hyderabad",
            "customerName": "Ravi Kumar",
            "customerPhone": "+919876543210",
            "address": "Flat 4, Green Park",
            "clientSecret": "sk_live_x",
            "franchiseeId": "ignored",
        }
    )
    assert summary["reference"] == "CRM-1" and summary["sku"] == "WP-100"
    assert summary["customerPhone"] == "+91XXXXXX3210"
    flat = repr(summary)
    for leaked in ("Ravi", "Green Park", "sk_live_", "9876543210", "franchisee"):
        assert leaked not in flat


def test_the_call_log_never_opens_a_second_connection() -> None:
    """The pool has ONE connection (`DB_POOL_SIZE=1`). A log written on a session
    of its own would wait for the connection its own request is holding and
    deadlock for 30 seconds. `record_call` must use the request's session."""
    import inspect

    from app.core import integration_log

    source = inspect.getsource(integration_log)
    assert "AsyncSessionLocal" not in source.split("async def sweep_api_log_retention")[0]
    assert "db" in inspect.signature(integration_log.record_call).parameters
