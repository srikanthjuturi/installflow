"""E.164 phone normalisation.

A technician's phone IS their identity — it is what the OTP resolves and what
the partial unique index on `users.phone` enforces. So it has to be stored in
exactly one shape, whatever a manager types: "98220 66301", "+91 98220-66301"
and "09822066301" are the same person.

India is the default country because every number in this product is Indian; a
number that already carries a country code is left alone.
"""

import re
from typing import Annotated

from pydantic import BeforeValidator, Field

DEFAULT_COUNTRY_CODE = "91"
INDIAN_NATIONAL_DIGITS = 10


def to_e164(value: str) -> str:
    """"+91 98220 66301", "9822066301", "09822066301" → "+919822066301"."""
    raw = (value or "").strip()
    explicit_plus = raw.startswith("+")
    digits = re.sub(r"\D", "", raw)

    if not explicit_plus:
        # A single leading zero is the Indian trunk prefix, not part of the
        # number. Strip it before deciding whether a country code is present.
        digits = digits.lstrip("0") or digits
        if len(digits) == INDIAN_NATIONAL_DIGITS:
            digits = DEFAULT_COUNTRY_CODE + digits

    return f"+{digits}" if digits else ""


def is_e164(value: str) -> bool:
    return bool(re.fullmatch(r"\+[1-9]\d{7,14}", value or ""))


#: A request field that normalises on the way in, then validates the shape.
Phone = Annotated[
    str,
    BeforeValidator(to_e164),
    Field(pattern=r"^\+[1-9]\d{7,14}$", description="E.164, e.g. +919822066301"),
]


def _optional_e164(value: str | None) -> str | None:
    """Normalise, treating blank as absent rather than as an error.

    A console form posts `""` for a field somebody left empty, and that means
    "no phone" — not "here is an invalid phone". Mapping it to None is what
    keeps an optional field optional; anything else present must still be a
    real number, so a typo is refused rather than stored.
    """
    if value is None:
        return None
    # Blank is decided from what was TYPED, not from what normalising produced.
    # "not-a-phone" contains no digits and normalises to nothing — reading that
    # as "left blank" would turn a typo into a silently missing number, which
    # is the one outcome worse than a validation error.
    if not str(value).strip():
        return None
    out = to_e164(value)
    if not is_e164(out):
        raise ValueError("Not a valid phone number")
    return out


#: An OPTIONAL request field that normalises on the way in.
#:
#: Separate from `Phone` because that one is required and a `Phone | None`
#: union would accept the empty string a form sends for "left blank" and then
#: fail its pattern — turning an omitted field into a validation error.
OptionalPhone = Annotated[str | None, BeforeValidator(_optional_e164)]
