"""GSTZen GSTIN Validator — the registry behind vendor autofill.

One POST with a GSTIN comes back with the registered name, the PAN, the
registration's standing and the principal address. That is six boxes on the
vendor form answered from one value the operator already holds.

**`status` and `valid` answer two different questions and must never be
conflated.** `valid: false` is a real answer ABOUT THE GSTIN — it is not
registered. `status: 0` is a fact about US — our subscription is exhausted or
expired — and carries no `valid` at all. So there are three outcomes, not two:

    found           fill the form
    not_registered  a real refusal; the console blocks the save
    unavailable     we could not ask; the console blocks NOTHING

That last one is the whole reason this module never raises. A lapsed
subscription is our problem, not the vendor's paperwork, and a form that cannot
be submitted because our billing failed is worse than one typed by hand. Same
rule `AddressFields` applies to a pincode it could not check.

Failures are RETURNED, like `whatsapp.SendResult` — for the same reason, and
with the same care about the token, which is never logged.

`map_response` is deliberately pure: it takes the parsed body and returns the
outcome, so the whole contract can be checked against the recorded payloads in
`RequirementDocs/GSTRequest.txt` without spending a metered call. That is what
`app.scripts.check_gstzen` does.
"""

import logging
from dataclasses import dataclass
from typing import Any, Literal

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

Outcome = Literal["found", "not_registered", "unavailable"]


@dataclass(frozen=True)
class GstinLookup:
    """What the registry says about one GSTIN. Every data field is optional."""

    outcome: Outcome
    #: Why, when the outcome is not `found`. Shown to the operator as-is, so it
    #: says what happened rather than naming GSTZen's billing state at them.
    reason: str | None = None
    #: The subscription itself is the problem — spent, lapsed, or a token GSTZen
    #: will not accept — rather than a timeout that will fix itself. Only this
    #: raises the alarm: emailing the National and Regional Heads every time a
    #: request times out would train them to ignore the one that matters.
    subscription_issue: bool = False

    #: `trade_name`, falling back to `legal_name` — our `vendors.name` is the
    #: trading name and the label the brand picker draws.
    name: str | None = None
    #: Only worth carrying when it DIFFERS from `name`; the console shows it
    #: beside the status so a trading name is never mistaken for the legal one.
    legal_name: str | None = None
    pan: str | None = None
    company_status: str | None = None
    #: Present when a registration has been cancelled. Not stored — shown, so
    #: nobody onboards a vendor on a dead GSTIN without noticing.
    cancellation_date: str | None = None

    #: The street line, as ONE box. Both forms ask for it that way.
    address: str | None = None
    city: str | None = None
    state: str | None = None
    pincode: str | None = None

    @classmethod
    def unavailable(cls, reason: str, *, subscription: bool = False) -> "GstinLookup":
        return cls(
            outcome="unavailable",
            reason=reason[:500],
            subscription_issue=subscription,
        )


def is_configured() -> bool:
    return bool(settings.GSTZEN_TOKEN)


def _clean(value: Any) -> str | None:
    """A tidied string, or None. GSTZen sends `""` for "no such field".

    Internal whitespace is COLLAPSED, not just trimmed: the registry really does
    return `"SANDEEP  SONI"` with two spaces, and these values are written
    straight into form boxes and then into our columns. A `.strip()` alone
    leaves that double space in the stored name, where nothing later will ever
    tidy it and a search for the single-spaced spelling will not find it.
    """
    if not isinstance(value, str):
        return None
    return " ".join(value.split()) or None


def _street(pradr: dict) -> str | None:
    """The street line, ASSEMBLED — never `pradr.addr`.

    `addr` is the whole thing flattened:

        SY NO 45, SAI NAGAR COLONY, BODUPPAL, Hyderabad, Medchal Malkajgiri,
        Telangana, 500039

    It already carries the city, the district, the state and the pincode, each
    of which has its own column here. Putting that in the "Building, street and
    area" box would store three of them twice, and the second copy is the one
    nothing keeps up to date.

    So the structured parts are joined instead, in the order an Indian address
    is written. `addr` remains the fallback for a record whose structured
    fields are empty — a duplicated address beats no address, and the operator
    can trim it.
    """
    parts = [
        _clean(pradr.get("building_number")) or _clean(pradr.get("addr1")),
        _clean(pradr.get("building_name")),
        _clean(pradr.get("floor_number")),
        _clean(pradr.get("street")),
        _clean(pradr.get("locality")) or _clean(pradr.get("addr2")),
        _clean(pradr.get("landmark")),
    ]

    # Real records repeat themselves — `street` and `locality` are sometimes the
    # same words. Case-insensitive, order preserving.
    seen: set[str] = set()
    kept: list[str] = []
    for part in parts:
        if part is None or part.casefold() in seen:
            continue
        seen.add(part.casefold())
        kept.append(part)

    return ", ".join(kept) or _clean(pradr.get("addr"))


def _check_consistency(gstin: str, pan: str | None, state_code: str | None) -> None:
    """A GSTIN encodes both of these, so a disagreement means we are wrong.

    Logged, never enforced: GSTZen is the authority on its own payload, and
    refusing a real registration over our assumption about the format would be
    the wrong way round. But we want to hear about it, because these two facts
    are what the PAN backfill in `d3f27a8c1904` relies on.
    """
    if state_code and gstin[:2] != state_code:
        logger.warning(
            "GSTIN %s starts %s but GSTZen reports state code %s",
            gstin,
            gstin[:2],
            state_code,
        )
    if pan and gstin[2:12] != pan.upper():
        logger.warning(
            "GSTIN %s carries PAN %s but GSTZen reports %s",
            gstin,
            gstin[2:12],
            pan,
        )


def map_response(gstin: str, body: Any) -> GstinLookup:
    """Turn one parsed GSTZen body into an outcome. Pure — no I/O, never raises.

    Order matters. `status` is asked FIRST, because a `status: 0` body has no
    `valid` key at all and reading its absence as "not registered" would tell an
    operator a real company does not exist because our subscription lapsed.
    """
    if not isinstance(body, dict):
        return GstinLookup.unavailable("The GST portal returned an unreadable response")

    if body.get("status") != 1:
        # Exhausted or expired, in GSTZen's own words. Logged at WARNING because
        # nothing else reports it: from the console this looks like one form
        # being slow, while in fact every vendor add has quietly lost autofill.
        message = _clean(body.get("message")) or "The GST portal rejected the request"
        logger.warning("GSTZen is not answering lookups: %s", message)
        # `status: 0` is GSTZen refusing the ACCOUNT, not the GSTIN — the two
        # documented cases are an exhausted package and an expired period, and
        # both need somebody to act. Flagged so the caller can raise the alarm.
        return GstinLookup.unavailable(message, subscription=True)

    if body.get("valid") is not True:
        return GstinLookup(
            outcome="not_registered",
            reason=f"{gstin} is not a registered GSTIN",
        )

    details = body.get("company_details")
    if not isinstance(details, dict) or not details:
        # A 200 that says `valid: true` and carries nothing is a malformed
        # answer, NOT evidence about the GSTIN. Never a refusal.
        return GstinLookup.unavailable(
            "The GST portal confirmed the GSTIN but sent no company details"
        )

    pradr = details.get("pradr")
    pradr = pradr if isinstance(pradr, dict) else {}
    state_info = details.get("state_info")
    state_info = state_info if isinstance(state_info, dict) else {}

    legal_name = _clean(details.get("legal_name"))
    trade_name = _clean(details.get("trade_name"))
    pan = _clean(details.get("pan"))

    _check_consistency(gstin, pan, _clean(state_info.get("code")))

    return GstinLookup(
        outcome="found",
        # The trading name is what a brand picker shows; the legal name is what
        # the certificate says. They are usually identical and occasionally not
        # — and only the difference is worth sending, so a console that renders
        # both never has to compare two strings to decide whether to.
        name=trade_name or legal_name,
        legal_name=legal_name if legal_name != trade_name else None,
        pan=pan.upper() if pan else None,
        company_status=_clean(details.get("company_status")),
        cancellation_date=_clean(details.get("cancellation_date")),
        address=_street(pradr),
        # `city` and not `district`: "Hyderabad", not "Medchal Malkajgiri".
        city=_clean(pradr.get("city")) or _clean(pradr.get("loc")),
        # `state_info.name` and NOT `state`, which is the display composite
        # "36 - Telangana TS" and would be stored verbatim.
        state=_clean(state_info.get("name")) or _clean(pradr.get("state_in_address")),
        pincode=_clean(pradr.get("pincode")) or _clean(pradr.get("pinc")),
    )


async def lookup(gstin: str) -> GstinLookup:
    """Ask the registry about one GSTIN. Never raises — see the module docstring.

    Costs one unit of a metered subscription per call, so the caller is expected
    not to ask twice for the same value; the console holds the answer with
    `staleTime: Infinity`.
    """
    if not is_configured():
        return GstinLookup.unavailable(
            "GSTIN lookup is not configured on this server"
        )

    # `verify` only differs where something intercepts TLS — see HTTP_CA_BUNDLE.
    verify = settings.HTTP_CA_BUNDLE or True

    try:
        async with httpx.AsyncClient(
            timeout=settings.GSTZEN_TIMEOUT_SECONDS, verify=verify
        ) as client:
            response = await client.post(
                settings.GSTZEN_URL,
                headers={
                    "token": settings.GSTZEN_TOKEN,
                    "Content-Type": "application/json",
                },
                json={"gstin": gstin},
            )
    except httpx.HTTPError as exc:
        logger.warning("GSTIN lookup could not reach GSTZen: %s", exc)
        return GstinLookup.unavailable("Could not reach the GST portal")

    try:
        body = response.json()
    except ValueError:
        logger.warning("GSTZen returned %s with no JSON body", response.status_code)
        return GstinLookup.unavailable(
            f"The GST portal returned {response.status_code}"
        )

    if response.status_code >= 400:
        # The body may still explain it — an expired subscription arrives as a
        # `status: 0` payload, which map_response words better than a bare code.
        message = _clean(body.get("message")) if isinstance(body, dict) else None
        logger.warning("GSTZen refused a lookup: %s %s", response.status_code, message)
        return GstinLookup.unavailable(
            message or f"The GST portal returned {response.status_code}",
            # A refused credential is an account problem like a spent package:
            # nobody's typing fixes it, and it stops autofill until somebody
            # acts. A 500 or a 429 is GSTZen having a moment — not the same.
            subscription=response.status_code in (401, 403),
        )

    return map_response(gstin, body)
