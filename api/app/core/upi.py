"""UPI virtual payment address (VPA) normalisation.

Where a technician's money goes. A VPA is `identifier@handle` —
`9822066301@ybl`, `sunil.pawar@okaxis` — and the handle names the bank or PSP
that will resolve it.

Two reasons this gets its own module rather than a regex inlined in a schema,
both the same reasons `phone.py` exists:

* **Two slices need it.** A manager sets it through `features/technicians` and a
  self-registering technician sends it through `features/onboarding`, and slices
  never import each other (hard rule 4).
* **One stored shape.** VPAs are case-insensitive, so `Sunil@OKAXIS` and
  `sunil@okaxis` are one account. Storing whichever spelling somebody typed
  would make two technicians look like they are paid to different places when
  they are not, and would defeat any future check for a duplicate.

Deliberately NOT verified against a bank. Nothing here can tell whether a
well-formed VPA actually exists — that answer only comes from attempting a
payment — so this rejects what is definitely not an address and accepts the
rest. A name-resolution check belongs with the payout that spends money on it.
"""

import re
from typing import Annotated

from pydantic import BeforeValidator, Field

#: The shape, deliberately permissive on the identifier and strict on the handle.
#:
#: The identifier half is a bank's business: banks issue VPAs containing dots,
#: hyphens, underscores and digits, and a rule tighter than the ones in the wild
#: would refuse a real technician's real account. The handle half is short,
#: alphabetic-led and has no dots in any live PSP handle (`ybl`, `okhdfcbank`,
#: `paytm`, `upi`, `apl`), which is what makes it worth checking at all: it is
#: how an email address typed into this box gets caught.
_VPA = re.compile(r"^[a-z0-9][a-z0-9._-]{1,48}@[a-z][a-z0-9]{1,29}$")

#: Matches the column, which is `String(256)`.
MAX_LENGTH = 256


def normalise(value: str) -> str:
    """Trim and lowercase. The one shape a VPA is stored in."""
    return (value or "").strip().lower()


def is_vpa(value: str) -> bool:
    return bool(_VPA.fullmatch(value or ""))


def _optional_vpa(value: str | None) -> str | None:
    """Normalise, treating blank as absent rather than as an error.

    A console form posts `""` for a box somebody left empty, and for this field
    that genuinely means "no payout account yet" — the common case, since
    neither onboarding mode requires one. Mapping blank to None is what keeps
    the field optional and what lets a manager CLEAR one that was typed wrong.

    Blank is decided from what was typed, not from what normalising produced, so
    a real typo is refused rather than silently becoming null — the same
    distinction `phone._optional_e164` draws, and for the same reason: an
    unusable value that vanishes is worse than one that errors.
    """
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    out = normalise(raw)
    if len(out) > MAX_LENGTH:
        raise ValueError(f"A UPI ID cannot be longer than {MAX_LENGTH} characters")
    if not is_vpa(out):
        raise ValueError(
            "Enter a UPI ID like name@bank — the part after @ is the bank or "
            "app, e.g. 9822066301@ybl"
        )
    return out


#: An OPTIONAL request field that normalises on the way in.
#:
#: There is no required variant, and there should not be one: a technician can
#: earn without a payout account and only needs it to be paid, so no screen in
#: this product may refuse to save a technician for want of one.
UpiId = Annotated[
    str | None,
    BeforeValidator(_optional_vpa),
    Field(default=None, description="UPI VPA, e.g. 9822066301@ybl"),
]
