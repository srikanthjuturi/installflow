"""WhatsApp Cloud API — sending the partner invite.

Two modes, because Meta treats them very differently:

* **template** (`WHATSAPP_TEMPLATE_NAME` set) — the only way to message someone
  who has NOT written to the business first. The template must already be
  approved in the WhatsApp Manager.
* **text** (no template configured) — free-form. Meta only delivers this inside
  the 24-hour customer-service window, i.e. to someone who messaged the business
  recently; anyone else is rejected with error 131047. Useful for testing, not
  for real invites.

Failures are RETURNED, never raised: a delivery problem must leave a recorded
invite that can be retried, not lose the record. The token is never logged.
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


def build_payload(phone: str, link: str, partner_type: str) -> dict:
    """The request body. Split out so it can be asserted without spending a send."""
    label = "franchise" if partner_type == "franchise" else "freelancer"

    if settings.WHATSAPP_TEMPLATE_NAME:
        return {
            "messaging_product": "whatsapp",
            "to": phone,
            "type": "template",
            "template": {
                "name": settings.WHATSAPP_TEMPLATE_NAME,
                "language": {"code": settings.WHATSAPP_TEMPLATE_LANG},
                "components": [
                    {
                        "type": "body",
                        "parameters": [
                            {"type": "text", "text": label},
                            {"type": "text", "text": link},
                        ],
                    }
                ],
            },
        }

    return {
        "messaging_product": "whatsapp",
        "to": phone,
        "type": "text",
        "text": {
            "preview_url": True,
            "body": (
                f"You have been invited to join Videocon Service as a {label}.\n\n"
                f"Install the technician app and register here:\n{link}\n\n"
                "This link is personal to you — please don't share it."
            ),
        },
    }


async def send_invite(phone: str, link: str, partner_type: str) -> SendResult:
    """Send one invite. Returns the outcome; never raises for a delivery failure."""
    if not is_configured():
        return SendResult.failure("WhatsApp is not configured on this server")

    url = f"{GRAPH}/{settings.WHATSAPP_API_VERSION}/{settings.WHATSAPP_PHONE_NUMBER_ID}/messages"
    headers = {"Authorization": f"Bearer {settings.WHATSAPP_TOKEN}"}
    payload = build_payload(phone, link, partner_type)

    # `verify` only differs where something intercepts TLS — see HTTP_CA_BUNDLE.
    verify = settings.HTTP_CA_BUNDLE or True

    try:
        async with httpx.AsyncClient(timeout=30, verify=verify) as client:
            response = await client.post(url, headers=headers, json=payload)
    except httpx.HTTPError as exc:
        logger.warning("WhatsApp send failed to reach Meta: %s", exc)
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
        logger.warning("WhatsApp rejected a send: %s", detail)
        return SendResult.failure(detail)

    message_id = (body.get("messages") or [{}])[0].get("id")
    return SendResult(ok=True, message_id=message_id)
