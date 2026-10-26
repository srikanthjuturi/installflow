"""Task 02 §6 case 13 — the websocket _Visibility refuses every franchise row.

The one place a franchise caller would otherwise HEAR something today (§4.3,
the company-wide leak): a fresh `_Visibility` defaults to `pincodes=set()`,
`all_india=False`, but `hears_notification(None, None)` returned True for every
null-pincode row. The `franchise` flag closes it; this pins the closure.
"""

import uuid

from app.core.realtime import TicketChanged
from app.features.tickets.ws import _Visibility


def _visibility(*, franchise: bool) -> _Visibility:
    visibility = _Visibility()
    visibility.franchise = franchise
    return visibility


# The leak, reproduced: without the flag a fresh viewer hears every
# company-wide row. (If this ever fails, the flag has silently stopped mattering.)
def test_without_the_flag_the_leak_is_still_there() -> None:
    assert _visibility(franchise=False).hears_notification(None, None)


def test_hears_no_company_wide_row() -> None:
    assert _visibility(franchise=True).hears_notification(None, None) is False


def test_hears_no_addressed_row_either() -> None:
    # `'payers'` reaches the payer only; a franchise principal is never the
    # payer — and no audience may reach them until a task opens a door.
    assert (
        _visibility(franchise=True).hears_notification("500032", None, "payers")
        is False
    )


def test_may_hear_nothing() -> None:
    event = TicketChanged(
        company_id=uuid.uuid4(),
        ticket_id=uuid.uuid4(),
        pincode="500032",
        vendor_id=uuid.uuid4(),
        created_by=None,
    )
    assert _visibility(franchise=True).may_hear(event) is False