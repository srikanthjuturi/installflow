"""`app.core.integration_errors` — the one table of refusals a CRM can receive."""

import pytest

from app.core.errors import AppError
from app.core.integration_errors import CODES, refusal

#: The codes `contracts/integration-api.md` promises. A code is never renamed, so
#: this list is the contract: removing one here is a breaking change.
PROMISED = {
    "VALIDATION_ERROR",
    "UNKNOWN_PINCODE",
    "UNKNOWN_SKU",
    "PRODUCT_INACTIVE",
    "SERIAL_UNKNOWN",
    "SERIAL_ON_OTHER_PRODUCT",
    "SERVICE_TYPE_NOT_SUPPORTED",
    "EXPECTED_DATE_PASSED",
    "VISIT_TIME_NOT_ALLOWED",
    "OUT_OF_CREDITS",
    "VENDOR_OUT_OF_CREDITS",
    "TOKEN_EXPIRED",
    "TOKEN_INVALID",
    "INVALID_CLIENT",
    "INTEGRATION_DISABLED",
    "RATE_LIMITED",
    "TICKET_NOT_FOUND",
}


def test_every_promised_code_exists() -> None:
    assert PROMISED <= set(CODES)


def test_codes_are_screaming_snake_with_a_message() -> None:
    for code, (status, message) in CODES.items():
        assert code == code.upper() and " " not in code
        assert 400 <= status < 500
        assert message.endswith(".") and len(message) > 15


def test_refusal_is_an_app_error_with_its_code_and_status() -> None:
    err = refusal("UNKNOWN_SKU")
    assert isinstance(err, AppError)
    assert err.code == "UNKNOWN_SKU" and err.status_code == 400
    assert "SKU" in err.detail


def test_refusal_can_carry_field_errors_and_headers() -> None:
    err = refusal(
        "VALIDATION_ERROR", errors=["pincode: required"], headers={"X-Test": "1"}
    )
    assert err.errors == ["pincode: required"] and err.headers == {"X-Test": "1"}
    assert refusal("RATE_LIMITED", headers={"Retry-After": "7"}).headers["Retry-After"] == "7"


def test_unknown_code_is_a_programming_error() -> None:
    with pytest.raises(KeyError):
        refusal("NOPE")


def test_no_message_leaks_internals() -> None:
    for _status, message in CODES.values():
        for word in ("traceback", "sql", "exception", "null", "uuid"):
            assert word not in message.lower()
