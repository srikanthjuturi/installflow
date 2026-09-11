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

## The pay link

`build_upi_uri` is the ONE place a `upi://pay?…` string is assembled. The amount
on the redeem screen, the amount inside the QR and the amount owed have to be one
number, and the only way to guarantee that is for no client to ever compute it:
both clients receive a finished string and draw a QR from it; neither parses or
rebuilds one. There is no gateway behind it — the payer's bank talks to the
technician's bank and never to us — so the link is an instruction, never a
receipt, and nothing here may mark anything paid because one was built.
"""

import re
from typing import Annotated
from urllib.parse import quote

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


#: Longest account name kept. UPI apps truncate well before this; a longer value
#: is not a name anybody's app will show.
NAME_MAX = 80


def _required_name(value: str | None) -> str:
    """The name on a UPI account: trimmed, spaces collapsed, 2–80 characters.

    Deliberately NOT restricted to letters. A bank prints what the account is
    registered as, and that includes initials with dots, a business's "&", and
    digits — refusing any of those would refuse a real account holder's real
    name. Control characters are the only thing stripped: they are never part
    of a name and would render as nothing on the payer's screen.
    """
    raw = "".join(c for c in str(value or "") if c.isprintable())
    out = " ".join(raw.split())
    if len(out) < 2:
        raise ValueError("Enter the name on the UPI account")
    if len(out) > NAME_MAX:
        raise ValueError(f"A UPI name cannot be longer than {NAME_MAX} characters")
    return out


def _required_vpa(value: str | None) -> str:
    out = _optional_vpa(value)
    if out is None:
        raise ValueError("Enter a UPI ID like name@bank")
    return out


#: A REQUIRED UPI ID, for the routes where one is the whole point — adding one,
#: or asking for it to be changed. `UpiId` above stays optional for the console
#: forms, where "no account yet" is a real answer.
RequiredUpiId = Annotated[str, BeforeValidator(_required_vpa)]

#: The name on the account, required wherever a UPI ID is being set by its owner.
UpiName = Annotated[str, BeforeValidator(_required_name)]


def _optional_name(value: str | None) -> str | None:
    if value is None or not str(value).strip():
        return None
    return _required_name(value)


#: Optional twin, for the console's add/edit forms.
OptionalUpiName = Annotated[
    str | None, BeforeValidator(_optional_name), Field(default=None)
]


class InvalidVpa(ValueError):
    """The string is not shaped like a UPI address."""


def format_amount(amount_paise: int) -> str:
    """Rupees with exactly two decimals, from paise — `425000` → `"4250.00"`.

    Integer arithmetic, not a float or a rounding mode: every amount in this
    product is already whole paise, so there is nothing to round and a float
    could only introduce the one-paisa disagreement this exists to prevent.

    Two decimals always, because a bare `4250` is accepted by some UPI apps and
    quietly mangled by others.
    """
    if amount_paise < 0:
        raise ValueError("A UPI amount cannot be negative")
    return f"{amount_paise // 100}.{amount_paise % 100:02d}"


#: What UPI apps reliably accept in a transaction note. Anything else is
#: STRIPPED rather than escaped: a note is a courtesy, and a link refused
#: because of a punctuation mark in a company's name is a payment nobody makes.
_NOTE_SAFE = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -"
)


def clean_note(text: str, limit: int = 50) -> str:
    return "".join(c for c in text if c in _NOTE_SAFE).strip()[:limit]


#: WHICH CHARACTERS SURVIVE UNENCODED, PER PARAMETER.
#:
#: `quote` never touches the unreserved set (A-Za-z0-9-._~) whatever `safe`
#: says, so this table decides only the rest — and for `pa` that is exactly one
#: character, `@`. BHIM, PhonePe and Paytm do NOT percent-decode `pa`, so
#: `pa=name%40bank` reaches them as a payee address called "name%40bank" and the
#: payer cannot pay. Google Pay decodes it and works, which is what makes this
#: look like three broken apps rather than one broken link — nothing in any log
#: says otherwise, and it cannot be seen by looking at the rendered QR.
#:
#: Unencoded is also what the spec says: RFC 3986 lists `@` in `pchar`, and
#: NPCI's own sample links print it plainly. Relaxing that one character cannot
#: let a value break out of its parameter, because `_VPA` admits no `&`.
#:
#: EVERY OTHER PARAMETER STAYS FULLY ENCODED, `pn` most of all: a technician
#: called "Ram & Sons" would otherwise end the query string at the ampersand and
#: the amount would fall off the end.
_SAFE_BY_KEY: dict[str, str] = {"pa": "@"}


def build_upi_uri(
    *,
    vpa: str,
    payee_name: str,
    amount_paise: int,
    note: str = "",
    ref: str = "",
) -> str:
    """The finished `upi://pay?…` string for one payment.

    Read the note on `_SAFE_BY_KEY` before touching the encoding line — an
    "obvious" tidy-up there stops payers at three of the four biggest apps in
    the country, and it fails silently.

    Deliberately absent: `mc`, `mode`, `orgid`, `sign`. Those belong to
    PSP-signed merchant flows; we have nothing to sign with, and sending them
    unsigned makes some apps refuse the link outright.
    """
    clean_vpa = normalise(vpa)
    if not is_vpa(clean_vpa):
        raise InvalidVpa(f"Not a UPI address: {vpa!r}")

    params = [
        ("pa", clean_vpa),
        # Never blank: an unnamed payee is what a scam looks like.
        ("pn", payee_name.strip() or "Technician"),
        ("am", format_amount(amount_paise)),
        ("cu", "INR"),
    ]
    if cleaned := clean_note(note):
        params.append(("tn", cleaned))
    if ref:
        # Short and alphanumeric — several apps silently refuse a long or
        # punctuated reference, and a refused link looks like a broken app.
        params.append(("tr", ref))

    query = "&".join(
        f"{k}={quote(str(v), safe=_SAFE_BY_KEY.get(k, ''))}" for k, v in params
    )
    return f"upi://pay?{query}"
