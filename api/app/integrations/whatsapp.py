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


def build_invite_payload(phone: str, link: str) -> dict:
    """The invite request body. Split out so it can be asserted without a send."""
    if settings.WHATSAPP_TEMPLATE_NAME:
        return _template_payload(
            phone,
            settings.WHATSAPP_TEMPLATE_NAME,
            settings.WHATSAPP_TEMPLATE_LANG,
            [link],
        )
    return _text_payload(
        phone,
        (
            "You have been invited to join Videocon Service as a technician.\n\n"
            f"Install the technician app and register here:\n{link}\n\n"
            "This link is personal to you — please don't share it."
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
            f"{code} is your Videocon Service verification code.\n\n"
            "It expires in 5 minutes. Do not share it with anyone."
        ),
    )


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
        # 131047 = outside the 24h window, i.e. a template is required.
        detail = err.get("message") or f"HTTP {response.status_code}"
        code = err.get("code")
        if code:
            detail = f"[{code}] {detail}"
        logger.warning("WhatsApp rejected a %s: %s", what, detail)
        return SendResult.failure(detail)

    message_id = (body.get("messages") or [{}])[0].get("id")
    return SendResult(ok=True, message_id=message_id)


async def send_invite(phone: str, link: str) -> SendResult:
    """Send one invite. Returns the outcome; never raises for a delivery failure."""
    return await _send(build_invite_payload(phone, link), what="invite")


async def send_otp(phone: str, code: str) -> SendResult:
    """Send one verification code. Never raises, and never logs the code."""
    return await _send(build_otp_payload(phone, code), what="otp")
