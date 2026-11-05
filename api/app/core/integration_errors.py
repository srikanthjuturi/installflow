"""The refusals a vendor's CRM can receive — one table, one place to review the words.

Every refusal is an `AppError`, so the standard envelope carries its `code`. The
codes are an API surface the vendor's developers write `if` statements against:
the TEXT may be improved at any time, a code is never renamed.

The messages are plain English written for a developer who has no access to our
logs, so each says what was wrong and what to do about it. They are gathered
here, and nowhere else, so the client can read them all in one sitting.
"""

from app.core.errors import AppError

#: code -> (HTTP status, message)
CODES: dict[str, tuple[int, str]] = {
    "VALIDATION_ERROR": (
        422,
        "The request has a missing or invalid field. See `errors` for each one.",
    ),
    "UNKNOWN_PINCODE": (
        400,
        "That pincode is not one we serve. Check it and send a six-digit pincode.",
    ),
    "UNKNOWN_SKU": (
        400,
        "No product of this vendor has that SKU. Ask the vendor to record the SKU "
        "on the product, or check the value you sent.",
    ),
    "PRODUCT_INACTIVE": (
        400,
        "That product, or its category, is switched off and cannot be booked.",
    ),
    "SERIAL_UNKNOWN": (
        400,
        "That serial number is not one of the serials loaded for this product.",
    ),
    "SERIAL_ON_OTHER_PRODUCT": (
        400,
        "That serial number belongs to a different product of this vendor.",
    ),
    "SERVICE_TYPE_NOT_SUPPORTED": (
        400,
        "This product does not support that type of visit.",
    ),
    "EXPECTED_DATE_PASSED": (
        400,
        "The expected date has already passed. Send today or a later date.",
    ),
    "VISIT_TIME_NOT_ALLOWED": (
        400,
        "That visit time is not one we can offer. Leave the time out and the "
        "customer will be asked to pick one.",
    ),
    "OUT_OF_CREDITS": (
        409,
        "New tickets are paused for this company. Please contact the company.",
    ),
    "VENDOR_OUT_OF_CREDITS": (
        409,
        "New tickets are paused for this vendor until its payment is settled.",
    ),
    "TOKEN_EXPIRED": (
        401,
        "The access token has expired. Get a new one with your refresh token or "
        "your client secret.",
    ),
    "TOKEN_INVALID": (
        401,
        "The token is missing, malformed, already used or not valid for this API.",
    ),
    "INVALID_CLIENT": (
        401,
        "The client id or client secret is not valid, or the credential has been "
        "revoked.",
    ),
    "INTEGRATION_DISABLED": (
        403,
        "This integration is switched off: the credential was revoked, the API "
        "channel is off for the vendor, or the vendor is paused.",
    ),
    "RATE_LIMITED": (
        429,
        "Too many calls. Wait and try again.",
    ),
    "TICKET_NOT_FOUND": (
        404,
        "No ticket of this vendor matches that number or reference.",
    ),
}


def refusal(
    code: str,
    detail: str | None = None,
    *,
    errors: list[str] | None = None,
    headers: dict[str, str] | None = None,
) -> AppError:
    """Build the `AppError` for `code`, with its standard message unless one is given."""
    status, message = CODES[code]
    return AppError(
        status_code=status,
        code=code,
        detail=detail or message,
        errors=errors,
        headers=headers,
    )
