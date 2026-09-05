"""WhatsApp Cloud API — technician invites and one-time codes.

Two modes, because Meta treats them very differently:

* **template** — the only way to message someone who has NOT written to the
  business first. The template must already be approved in WhatsApp Manager.
* **text** (no template configured) — free-form. Meta only delivers this inside
  the 24-hour customer-service window, i.e. to someone who messaged the business
  recently; anyone else is rejected with error 131047. Useful for testing, not
  for real sends.

Invites and codes need SEPARATE templates: a one-time code has to go through a
template in Meta's AUTHENTICATION category, which is reviewed separately from
the UTILITY one an invite uses and cannot be substituted for it.

Failures are RETURNED, never raised: a delivery problem must leave a recorded
invite that can be retried, not lose the record. Neither the token nor the code
is ever logged.
"""

import logging
from dataclasses import dataclass

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

GRAPH = "https://graph.facebook.com"


@dataclass
class SendResult:
    ok: bool
    message_id: str | None = None
    error: str | None = None

    @classmethod
    def failure(cls, error: str) -> "SendResult":
        return cls(ok=False, error=error[:500])


def is_configured() -> bool:
    return bool(settings.WHATSAPP_TOKEN and settings.WHATSAPP_PHONE_NUMBER_ID)


def _template_payload(
    phone: str, name: str, lang: str, params: list[str], *, otp_button: bool = False
) -> dict:
    components: list[dict] = [
        {
            "type": "body",
            "parameters": [{"type": "text", "text": p} for p in params],
        }
    ]
    if otp_button:
        # An AUTHENTICATION template carries a copy-code button, and Meta
        # requires the code repeated in the button component.
        components.append(
            {
                "type": "button",
                "sub_type": "url",
                "index": "0",
                "parameters": [{"type": "text", "text": params[0]}],
            }
        )
    return {
        "messaging_product": "whatsapp",
        "to": phone,
        "type": "template",
        "template": {
            "name": name,
            "language": {"code": lang},
            "components": components,
        },
    }


def _text_payload(phone: str, body: str, *, preview_url: bool = False) -> dict:
    return {
        "messaging_product": "whatsapp",
        "to": phone,
        "type": "text",
        "text": {"preview_url": preview_url, "body": body},
    }


def build_invite_payload(phone: str, link: str, company: str) -> dict:
    """The invite request body. Split out so it can be asserted without a send.

    Two parameters, company then link, matching the `technician_invite`
    template. The company is a parameter rather than baked into the template
    because this platform is multi-tenant — one WABA sends for every company on
    it, and a template naming one of them would be wrong for all the others.

    The link is a BODY parameter and not a URL button on purpose: a button
    stores its domain inside the template, so moving off the dev tunnel to a
    real domain would need a fresh template and another Meta review. As a
    parameter the domain is just INVITE_LINK_BASE.
    """
    if settings.WHATSAPP_TEMPLATE_NAME:
        return _template_payload(
            phone,
            settings.WHATSAPP_TEMPLATE_NAME,
            settings.WHATSAPP_TEMPLATE_LANG,
            [company, link],
        )
    # No template configured. Meta accepts this and returns a message id, but
    # only DELIVERS it if the recipient messaged this number in the last 24
    # hours — otherwise it is dropped with 131047, which is invisible without a
    # webhook. Development only; a template is what makes an invite arrive.
    return _text_payload(
        phone,
        (
            f"You have been invited to join {company} as a service technician.\n\n"
            f"Install the technician app and complete your registration:\n{link}\n\n"
            "This link is personal to you. Please do not share it."
        ),
        preview_url=True,
    )


def build_otp_payload(phone: str, code: str) -> dict:
    if settings.WHATSAPP_OTP_TEMPLATE_NAME:
        return _template_payload(
            phone,
            settings.WHATSAPP_OTP_TEMPLATE_NAME,
            settings.WHATSAPP_OTP_TEMPLATE_LANG,
            [code],
            otp_button=True,
        )
    return _text_payload(
        phone,
        (
            f"{code} is your Reliance GreenTech Service verification code.\n\n"
            "It expires in 5 minutes. Do not share it with anyone."
        ),
    )


def build_slot_request_payload(
    phone: str, link: str, company: str, product: str
) -> dict:
    """"Pick a time for your installation" — with the link that does it.

    Same shape as the invite: company as a parameter because one WABA sends for
    every tenant, and the link in the BODY rather than a URL button so the
    domain can change without another Meta review.

    The product is named because a customer may have more than one thing on
    order, and "pick a slot" without saying for what is a message people ignore.
    """
    if settings.WHATSAPP_SLOT_TEMPLATE_NAME:
        return _template_payload(
            phone,
            settings.WHATSAPP_SLOT_TEMPLATE_NAME,
            settings.WHATSAPP_SLOT_TEMPLATE_LANG,
            [company, product, link],
        )
    # Development only — see build_invite_payload for why a template is what
    # makes this actually arrive.
    return _text_payload(
        phone,
        (
            f"{company}: your {product} visit is ready to be scheduled.\n\n"
            f"Please choose a time that suits you:\n{link}\n\n"
            "We will assign a technician once you have confirmed a time."
        ),
        preview_url=True,
    )


def build_slot_confirmed_payload(
    phone: str, company: str, product: str, when: str
) -> dict:
    """"Your slot is confirmed" — the receipt, sent on both routes.

    Sent whether ops agreed the time on a call or the customer picked it
    themselves, because from the customer's side those are the same event and
    only one of them otherwise leaves them with anything in writing.
    """
    if settings.WHATSAPP_SLOT_CONFIRMED_TEMPLATE_NAME:
        return _template_payload(
            phone,
            settings.WHATSAPP_SLOT_CONFIRMED_TEMPLATE_NAME,
            settings.WHATSAPP_SLOT_TEMPLATE_LANG,
            [company, product, when],
        )
    return _text_payload(
        phone,
        (
            f"{company}: your {product} visit is confirmed for {when}.\n\n"
            "Our technician will call you before arriving. To change the time, "
            "please contact us."
        ),
    )


def build_feedback_payload(
    phone: str, link: str, company: str, product: str, technician: str
) -> dict:
    """"Your installation is complete — please confirm it." With the link.

    The one message in this app that asks the customer to CLOSE something
    rather than to schedule it. It names the technician because the customer
    met them an hour ago, and "was this done properly" is a question about a
    person, not about a company.

    Same construction as the other three: company as a parameter because one
    WABA sends for every tenant, and the link in the BODY rather than a URL
    button so the domain can move without another Meta review.

    Registered as `job_feedback` (UTILITY, en_US, four body parameters):

        Your {{2}} installation from {{1}} is complete.

        {{3}} has finished the work. Please confirm it was done and rate
        your experience:
        {{4}}

        This helps us make sure every job is done properly.

    It opens with "Your", not with {{1}}, because Meta rejects a body that
    starts or ends with a variable — error subcode 2388299. The parameter
    NUMBERING is unchanged by that reordering, so the argument list below still
    reads company, product, technician, link.
    """
    if settings.WHATSAPP_FEEDBACK_TEMPLATE_NAME:
        return _template_payload(
            phone,
            settings.WHATSAPP_FEEDBACK_TEMPLATE_NAME,
            settings.WHATSAPP_FEEDBACK_TEMPLATE_LANG,
            [company, product, technician, link],
        )
    # Development only — see build_invite_payload for why a template is what
    # makes this actually arrive.
    return _text_payload(
        phone,
        (
            f"{company}: your {product} installation is complete.\n\n"
            f"{technician} has finished the work. Please confirm it was done "
            f"and rate your experience:\n{link}\n\n"
            "This helps us make sure every job is done properly."
        ),
        preview_url=True,
    )


def build_technician_details_payload(
    phone: str, company: str, product: str, when: str, technician: str, mobile: str
) -> dict:
    """"Your technician today is X, on 98xxx." Sent shortly before the slot.

    The only message this system sends a customer that names a PERSON and hands
    over their number. Everything before it is scheduling — pick a time, the
    time is booked — and by then the customer knows when somebody is coming but
    not who, which is the gap somebody at the door has to close by explaining
    themselves.

    Two things follow from that and neither is decoration. A stranger who was
    announced by name is let in; one who was not is a stranger at the door.
    And a customer who can ring the technician directly rings the technician
    rather than the vendor, ops, or nobody — which is how a five-minute delay
    stops becoming a missed slot and a cancellation band.

    The slot is repeated even though `slot_confirmed` already stated it. That
    message may be two days old by now, and a reminder that omits the time
    makes the customer go looking for it.

    Registered as `technician_assigned` (UTILITY, en_US, five body parameters):

        Your {{2}} visit from {{1}} is today at {{3}}.

        {{4}} will be attending. You can reach them on {{5}} if you need to.

        Please make sure someone is available at the address.

    Opens with "Your", not with {{1}}: Meta rejects a body that starts or ends
    with a variable — subcode 2388299, which has already cost two submissions
    here. The company is a parameter for the reason it is in every other
    template: one WABA sends for every tenant on this platform.
    """
    if settings.WHATSAPP_TECHNICIAN_TEMPLATE_NAME:
        return _template_payload(
            phone,
            settings.WHATSAPP_TECHNICIAN_TEMPLATE_NAME,
            settings.WHATSAPP_TECHNICIAN_TEMPLATE_LANG,
            [company, product, when, technician, mobile],
        )
    # Development only — see build_invite_payload for why a template is what
    # makes this actually arrive.
    return _text_payload(
        phone,
        (
            f"{company}: your {product} visit is today at {when}.\n\n"
            f"{technician} will be attending. You can reach them on {mobile} "
            "if you need to.\n\n"
            "Please make sure someone is available at the address."
        ),
    )


#: Meta failure codes worth translating, because each one has a different fix
#: and the raw text names none of them. Anything absent falls through to Meta's
#: own message rather than being flattened into "something went wrong".
EXPLAINED: dict[int, str] = {
    131047: (
        "WhatsApp will not deliver a plain message to someone who has not "
        "messaged this number in the last 24 hours. An approved template is "
        "needed."
    ),
    132001: (
        "The WhatsApp template is not approved yet — Meta is still reviewing "
        "it. Invites will send as soon as it is."
    ),
    132000: "The template was sent the wrong number of values. This is a bug, not a setting.",
    133010: (
        "This number is verified but was never registered to the WhatsApp "
        "Cloud API, so it cannot send. It needs a one-time registration with a "
        "6-digit PIN."
    ),
    131026: "That number cannot receive WhatsApp messages.",
    190: "The WhatsApp access token has expired. A new one is needed.",
    100: "WhatsApp rejected the request as malformed. This is a bug, not a setting.",
    80007: "WhatsApp is rate limiting this number. Try again shortly.",
}


def _allowed(phone: str) -> bool:
    """Whether this number may receive a real message.

    An empty allowlist means "anyone" — the production setting. A non-empty one
    is the dev guard: live credentials and a test suite together will otherwise
    send WhatsApp messages to invented numbers that belong to real people.
    """
    raw = settings.WHATSAPP_ALLOWLIST.strip()
    if not raw:
        return True
    return phone in {n.strip() for n in raw.split(",") if n.strip()}


async def _send(payload: dict, *, what: str) -> SendResult:
    if not is_configured():
        return SendResult.failure("WhatsApp is not configured on this server")

    to = str(payload.get("to", ""))
    if not _allowed(to):
        logger.warning("Blocked a %s to %s — not in WHATSAPP_ALLOWLIST", what, to)
        return SendResult.failure(
            f"{to} is not in WHATSAPP_ALLOWLIST, so nothing was sent"
        )

    url = (
        f"{GRAPH}/{settings.WHATSAPP_API_VERSION}"
        f"/{settings.WHATSAPP_PHONE_NUMBER_ID}/messages"
    )
    headers = {"Authorization": f"Bearer {settings.WHATSAPP_TOKEN}"}

    # `verify` only differs where something intercepts TLS — see HTTP_CA_BUNDLE.
    verify = settings.HTTP_CA_BUNDLE or True

    try:
        async with httpx.AsyncClient(timeout=30, verify=verify) as client:
            response = await client.post(url, headers=headers, json=payload)
    except httpx.HTTPError as exc:
        logger.warning("WhatsApp %s failed to reach Meta: %s", what, exc)
        return SendResult.failure(f"Could not reach WhatsApp: {exc}")

    try:
        body = response.json()
    except ValueError:
        return SendResult.failure(
            f"WhatsApp returned {response.status_code} with no JSON body"
        )

    if response.status_code >= 400 or "error" in body:
        err = body.get("error", {})
        raw = err.get("message") or f"HTTP {response.status_code}"
        code = err.get("code")
        # The console shows this string to a manager who cannot act on
        # "(#132001) Template name does not exist in the translation" but can
        # act on "the template is still being reviewed". The raw text still
        # goes to the log, where the person who CAN act will look.
        detail = EXPLAINED.get(code, raw)
        logger.warning("WhatsApp rejected a %s: [%s] %s", what, code, raw)
        return SendResult.failure(detail)

    message_id = (body.get("messages") or [{}])[0].get("id")
    return SendResult(ok=True, message_id=message_id)


def build_escalation_payload(
    phone: str, company: str, code: str, area: str, left: str
) -> dict:
    """"Nobody has taken this job and the slot is close." To the area manager.

    The only message this system sends to its OWN staff. Everything else here
    goes to a customer or a technician, and the reason for the exception is
    that managers have no mobile app — the console's bell is a badge they see
    when they next open a browser tab, which is no use at nine in the evening
    for a job whose slot is at eight tomorrow.

    Registered as `job_escalation` (UTILITY, en_US, four body parameters):

        Escalation from {{1}}: job {{2}} at {{3}} still has no technician and
        the slot is {{4}}.

        Open the ops console to reassign it or add a bonus.

    Opens with "Escalation" rather than a variable — Meta rejects a body that
    starts or ends with one (subcode 2388299), which cost a submission on the
    feedback template before this one.

    ⚠ **{{4}} must complete "the slot is …", not repeat the noun.** It was fed
    `hours_to()`, which appends "to slot", so every message this template has
    ever sent read "the slot is 2h 40m to slot". Fixed at the CALLER — see
    `core.escalation.whatsapp_the_area_manager`, which now passes "in 2h 40m" —
    rather than by editing the body, because the body is registered with Meta
    and re-approval costs days for a wording change the parameter can absorb.

    ⚠ **The fallback below says "assign a technician"; the registered body
    still says "reassign it".** Deliberate, and not to be "fixed" by making
    them match: nothing was ever assigned, so there is nothing to RE-assign,
    and the word sends a manager looking for a technician to replace. The
    fallback carries the corrected wording; the registered body needs a
    re-submission to Meta, which is a days-long round trip nobody should
    trigger for one word in isolation. Correct it with the next template
    change.
    """
    if settings.WHATSAPP_ESCALATION_TEMPLATE_NAME:
        return _template_payload(
            phone,
            settings.WHATSAPP_ESCALATION_TEMPLATE_NAME,
            settings.WHATSAPP_ESCALATION_TEMPLATE_LANG,
            [company, code, area, left],
        )
    # Development only — see build_invite_payload for why a template is what
    # makes this actually arrive.
    return _text_payload(
        phone,
        (
            f"Escalation from {company}: job {code} at {area} still has no "
            f"technician and the slot is {left}.\n\n"
            "Open the ops console to assign a technician or add a bonus."
        ),
    )


async def send_escalation(
    phone: str, company: str, code: str, area: str, left: str
) -> SendResult:
    """Tell an area manager a job is about to miss its slot. Never raises."""
    return await _send(
        build_escalation_payload(phone, company, code, area, left),
        what="escalation",
    )


async def send_invite(phone: str, link: str, company: str) -> SendResult:
    """Send one invite. Returns the outcome; never raises for a delivery failure."""
    return await _send(build_invite_payload(phone, link, company), what="invite")


async def send_otp(phone: str, code: str) -> SendResult:
    """Send one verification code. Never raises, and never logs the code."""
    return await _send(build_otp_payload(phone, code), what="otp")


async def send_slot_request(
    phone: str, link: str, company: str, product: str
) -> SendResult:
    """Ask the customer to pick a time. Never raises for a delivery failure."""
    return await _send(
        build_slot_request_payload(phone, link, company, product),
        what="slot request",
    )


async def send_slot_confirmed(
    phone: str, company: str, product: str, when: str
) -> SendResult:
    """Tell the customer their time is booked. Never raises."""
    return await _send(
        build_slot_confirmed_payload(phone, company, product, when),
        what="slot confirmation",
    )


async def send_feedback_request(
    phone: str, link: str, company: str, product: str, technician: str
) -> SendResult:
    """Ask the customer to confirm the job is done. Never raises.

    A refusal is not an error for the caller: the work happened and the ticket
    records it, so ops can resend or read the link down the phone. Losing the
    completion over a message would be the worse failure by far.
    """
    return await _send(
        build_feedback_payload(phone, link, company, product, technician),
        what="feedback request",
    )


def build_job_accepted_payload(
    phone: str,
    company: str,
    product: str,
    technician: str,
    mobile: str,
    when: str | None,
) -> dict:
    """"Ravi has accepted your visit." Sent the moment a technician takes it.

    A SECOND customer message about the same person, and the difference from
    `build_technician_details_payload` is the whole reason it exists. That one
    is a reminder shortly before a slot and says "today at 2:00 PM"; this one
    fires at acceptance, which can now happen before any time is agreed at all.

    So the time is a parameter that is sometimes a slot and sometimes a promise
    — and that is exactly what Meta will not let one template be. A body reading
    "is today at {{3}}" cannot carry "once you pick a time"; approval is granted
    against the wording, not the placeholder.

    Registered as `job_accepted` (UTILITY, en_US, five body parameters):

        Your {{2}} visit from {{1}} has been accepted.

        {{4}} will be attending{{3}}. You can reach them on {{5}} if you need to.

        Please make sure someone is available at the address.

    `{{3}}` completes the sentence rather than standing alone — " on Thu 21 Aug,
    2:00–4:00 PM", or " once you have picked a time". The same shape the
    escalation template needed after `{{4}}` once rendered "the slot is 2h 40m
    to slot"; a parameter that has to read as part of a sentence must be given
    one to be part of.

    Opens with "Your", not with {{1}}: Meta rejects a body starting or ending
    with a variable — subcode 2388299, which has cost two submissions here.
    """
    tail = f" on {when}" if when else " once you have picked a time"
    if settings.WHATSAPP_ACCEPTED_TEMPLATE_NAME:
        return _template_payload(
            phone,
            settings.WHATSAPP_ACCEPTED_TEMPLATE_NAME,
            settings.WHATSAPP_ACCEPTED_TEMPLATE_LANG,
            [company, product, tail, technician, mobile],
        )
    # Development only — see build_invite_payload for why a template is what
    # makes this actually arrive.
    return _text_payload(
        phone,
        (
            f"{company}: your {product} visit has been accepted.\n\n"
            f"{technician} will be attending{tail}. You can reach them on "
            f"{mobile} if you need to.\n\n"
            "Please make sure someone is available at the address."
        ),
    )


def build_job_accepted_manager_payload(
    phone: str,
    company: str,
    manager: str,
    code: str,
    technician: str,
    area: str,
    when: str | None,
) -> dict:
    """The same news to the manager answerable for that ground.

    The second message this system sends its own STAFF, and it exists for the
    opposite reason to the escalation one. That interrupts because something has
    gone wrong; this one tells somebody their area is covered — quieter news,
    and worth sending precisely because nothing else does.

    It reaches EXACTLY ONE person: `core.coverage.nearest_manager_for` walks
    AM-by-state → RH-by-region → National Head and stops at the first reachable
    one. The bell already reached all of them by territory; this is the
    interruption, and an interruption everybody gets is one nobody reads.

    No customer name and no phone number: a manager needs to know who is going
    where, and the customer's details are on the ticket for whoever opens it.

    Registered as `job_accepted_manager` (UTILITY, en_US, FOUR body parameters):

        Hello {{2}}, one of the jobs in your area has just been accepted.

        {{3}} has taken {{4}}.

        Nothing needs doing. Open the {{1}} console if you want the full
        ticket, the customer's details, or to reassign it.

    ⚠ Four, not six, and the body is deliberately wordy. Meta rejected the
    first submission with subcode **2388293 — "Parameters words ratio exceeds
    limit"**: a short body with many variables reads as a template built to
    smuggle arbitrary content past review, so it is refused. The fix is both
    halves — fewer variables AND more fixed words.

    So the ticket code, the area and the time are concatenated into `{{4}}`
    rather than being three parameters. They are always rendered together in
    that order anyway, which is what makes them one fact rather than three.
    """
    tail = f", for {when}" if when else " — no time agreed yet"
    detail = f"{code} in {area}{tail}"
    if settings.WHATSAPP_ACCEPTED_MANAGER_TEMPLATE_NAME:
        return _template_payload(
            phone,
            settings.WHATSAPP_ACCEPTED_MANAGER_TEMPLATE_NAME,
            settings.WHATSAPP_ACCEPTED_MANAGER_TEMPLATE_LANG,
            [company, manager, technician, detail],
        )
    return _text_payload(
        phone,
        (
            f"Hello {manager}, one of the jobs in your area has just been "
            f"accepted.\n\n{technician} has taken {detail}.\n\n"
            f"Nothing needs doing. Open the {company} console if you want the "
            "full ticket, the customer's details, or to reassign it."
        ),
    )


async def send_job_accepted(
    phone: str,
    company: str,
    product: str,
    technician: str,
    mobile: str,
    when: str | None,
) -> SendResult:
    """Tell the customer who accepted their visit. Never raises.

    A refusal costs the courtesy, not the job — the technician is assigned
    either way, and the ticket's own trail records what Meta said.
    """
    return await _send(
        build_job_accepted_payload(phone, company, product, technician, mobile, when),
        what="job accepted",
    )


async def send_job_accepted_manager(
    phone: str,
    company: str,
    manager: str,
    code: str,
    technician: str,
    area: str,
    when: str | None,
) -> SendResult:
    """Tell the nearest manager their area is covered. Never raises."""
    return await _send(
        build_job_accepted_manager_payload(
            phone, company, manager, code, technician, area, when
        ),
        what="job accepted (manager)",
    )


async def send_technician_details(
    phone: str, company: str, product: str, when: str, technician: str, mobile: str
) -> SendResult:
    """Tell the customer who is coming, and how to reach them. Never raises.

    A refusal costs the courtesy, not the visit: the technician still turns up
    at the time the customer already confirmed. The sweep records what Meta
    said on the ticket's own trail, which is where somebody asking "why did
    nobody tell me who was coming" will look.
    """
    return await _send(
        build_technician_details_payload(
            phone, company, product, when, technician, mobile
        ),
        what="technician details",
    )
