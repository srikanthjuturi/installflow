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
