"""Azure Communication Services — the outbound email channel.

Shaped after `whatsapp.py`, and for the same reason: failures are RETURNED,
never raised. A user creation that has already committed must not 500 because
the mail did not go out — the account exists, the caller is entitled to know the
password, and an exception here would leave them with neither.

Two things worth knowing before changing anything in this file.

**A 202 is not delivery.** `begin_send` queues the message; ACS accepts it and
answers with an operation id. An asynchronous bounce afterwards is invisible to
us — we have no Event Grid subscription — so `ok=True` means "Azure took it",
not "it arrived". Same caveat the WhatsApp send carries.

**The poller is deliberately never awaited to completion.** `poller.result()`
polls until ACS reports Succeeded or Failed, which takes seconds, and creating a
user blocks on this call. We take the 202 and move on.

Nothing here is ever logged in full: not the html, not the plain text, and above
all not the temporary password one of these bodies contains.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass

from azure.core.exceptions import AzureError, HttpResponseError
from azure.communication.email.aio import EmailClient

from app.core.config import settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class EmailSendResult:
    ok: bool
    #: The id we minted for this send. Not idempotency — a retry gets a new one.
    #: Its value is that it is knowable without touching the poller, so it lands
    #: in the log and is what you paste into the ACS delivery diagnostics (or
    #: hand to Azure support) to find this exact message.
    operation_id: str | None = None
    error: str | None = None

    @staticmethod
    def failure(message: str) -> "EmailSendResult":
        # Truncated like SendResult.failure — these end up in an API response.
        return EmailSendResult(ok=False, error=message[:500])


def is_configured() -> bool:
    return bool(settings.ACS_CONNECTION_STRING and settings.ACS_SENDER_ADDRESS)


#: ACS error codes seen for real, checked BEFORE the status map because the
#: status alone is misleading here: `DomainNotLinked` arrives as a 404, which
#: reads as "the resource does not exist" and sends somebody hunting the
#: connection string when the sender address is what is wrong. Grow this from
#: observed failures the way the WhatsApp table grew — do not invent entries.
EXPLAINED_CODES: dict[str, str] = {
    "DomainNotLinked": (
        "ACS_SENDER_ADDRESS is not a verified MailFrom of this Communication "
        "Services resource, so Azure refused to send as it."
    ),
}

#: Keyed on HTTP status, which is documented and stable. Consulted only when the
#: code above is unrecognised. Anything unmapped falls through to Azure's own
#: message: never flatten an unknown failure into "something went wrong".
EXPLAINED: dict[int, str] = {
    400: (
        "Azure rejected the message. Usually the sender address is not a "
        "verified MailFrom of this Communication Services resource."
    ),
    401: "The Azure Communication Services access key is wrong or has been rotated.",
    403: (
        "Azure refused this send — the sender address or the recipient is "
        "blocked on this resource."
    ),
    404: (
        "Azure could not find what this send names — usually the sender "
        "domain, sometimes the resource in the connection string."
    ),
    429: "Azure is rate limiting this resource. Try again shortly.",
}


def _explain(exc: HttpResponseError) -> str:
    """Translate a refusal into something a manager can act on."""
    code = getattr(getattr(exc, "error", None), "code", None)
    if code and code in EXPLAINED_CODES:
        return EXPLAINED_CODES[code]
    explained = EXPLAINED.get(exc.status_code or 0)
    if explained:
        # Keep Azure's own code alongside ours — it is what a search finds.
        return f"{explained} ({code})" if code else explained
    return str(exc.message or exc)


def _allowed(address: str) -> bool:
    """Development guard. Empty allowlist means everyone, i.e. production.

    Development and production share one ACS resource, so a live key plus
    somebody exercising the create form sends real mail to invented addresses
    that belong to real people. Set ACS_EMAIL_ALLOWLIST to your own address
    while testing; `publish.py` refuses to deploy with it set.
    """
    raw = settings.ACS_EMAIL_ALLOWLIST.strip()
    if not raw:
        return True
    allowed = {a.strip().lower() for a in raw.split(",") if a.strip()}
    return address.strip().lower() in allowed


def _client() -> EmailClient:
    # Constructed per send and closed by the caller's `async with`, mirroring
    # blob._client(). The aio client holds an aiohttp session; a module-level
    # one would outlive the event loop it was built on.
    return EmailClient.from_connection_string(
        settings.ACS_CONNECTION_STRING,
        # Parity with whatsapp._send: a dev box behind a TLS-intercepting proxy
        # needs its root here or every send fails certificate verification.
        connection_verify=settings.HTTP_CA_BUNDLE or True,
        # azure-core retries three times by default, which would make the
        # timeout below bound one attempt rather than the whole call.
        retry_total=1,
    )


async def send(
    *,
    to: str,
    subject: str,
    html: str,
    plain_text: str,
    display_name: str | None = None,
    what: str,
) -> EmailSendResult:
    """Queue one email. Never raises.

    `what` is the log label, as in `whatsapp._send`.
    """
    if not is_configured():
        return EmailSendResult.failure("Email is not configured on this server")
    if not _allowed(to):
        logger.warning("Email to %s refused by ACS_EMAIL_ALLOWLIST (%s)", to, what)
        return EmailSendResult.failure(
            "This address is not on ACS_EMAIL_ALLOWLIST, so no email was sent"
        )

    operation_id = str(uuid.uuid4())
    message = {
        "senderAddress": settings.ACS_SENDER_ADDRESS,
        "recipients": {
            "to": [{"address": to, "displayName": display_name or to}],
        },
        "content": {"subject": subject, "plainText": plain_text, "html": html},
    }

    try:
        async with _client() as client:
            # Returning from this await means ACS answered 202 and queued it.
            await asyncio.wait_for(
                client.begin_send(message, operation_id=operation_id),
                timeout=settings.ACS_TIMEOUT_SECONDS,
            )
    except asyncio.TimeoutError:
        logger.warning("ACS send timed out after %ss (%s)", settings.ACS_TIMEOUT_SECONDS, what)
        return EmailSendResult.failure("Email is taking too long to send")
    except HttpResponseError as exc:
        # Must precede AzureError — HttpResponseError subclasses it.
        logger.warning("ACS refused %s (HTTP %s): %s", what, exc.status_code, exc)
        return EmailSendResult.failure(_explain(exc))
    except AzureError as exc:
        logger.warning("ACS send failed (%s): %s", what, exc)
        return EmailSendResult.failure(f"Could not send the email: {exc}")

    logger.info("Queued %s to %s (operation %s)", what, to, operation_id)
    return EmailSendResult(ok=True, operation_id=operation_id)
