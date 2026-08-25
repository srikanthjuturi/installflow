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
            f"Install the technician app and register here:\n{link}\n\n"
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
            f"Pick a time that suits you:\n{link}\n\n"
            "The sooner you choose, the sooner we can assign a technician."
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
            "Our technician will call before arriving. To change the time, "
            "reply to this message or call us."
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

    Template to register (UTILITY, four body parameters):

        {{1}}: your {{2}} installation is complete.
        {{3}} has finished the work. Please confirm and rate your
        experience: {{4}}
        This helps us make sure every job is done properly.
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
