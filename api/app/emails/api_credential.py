"""The email that carries a vendor's new API credentials. Never raises.

Sent to the vendor's primary login address by the credentials slice, after the
credential is committed. If it cannot be sent the slice hands the secret back on
the admin's screen instead — the same fallback a vendor's temporary password has —
so a failure here is reported, never fatal.

The company is a PARAMETER, never a literal: one sender serves every tenant.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from app.core.config import settings
from app.emails.render import render
from app.integrations import acs_email
from app.integrations.acs_email import EmailSendResult

logger = logging.getLogger(__name__)


def api_base_url() -> str:
    """The address a CRM calls, derived from the one public host this API has.

    `SLOT_LINK_BASE` is `<host>/slot` (the customer page), so the host is
    everything before it; the integration routes sit under the API prefix.
    """
    host = settings.SLOT_LINK_BASE.rstrip("/")
    if host.endswith("/slot"):
        host = host[: -len("/slot")]
    return f"{host}{settings.API_V1_PREFIX}/integration"


async def send_api_credential(
    *,
    to: str,
    full_name: str | None,
    company_name: str,
    vendor_name: str,
    client_id: str,
    client_secret: str,
) -> EmailSendResult:
    """Send a new credential's Client ID and secret. Never raises, never logs the secret."""
    subject = f"Your {company_name} API credentials"
    greeting = f"Hello {full_name}," if full_name else "Hello,"
    base = api_base_url()
    try:
        html = render(
            "api_credential",
            subject=subject,
            company=company_name,
            greeting=greeting,
            vendor=vendor_name,
            base_url=base,
            client_id=client_id,
            client_secret=client_secret,
            year=datetime.now(timezone.utc).year,
        )
        plain_text = (
            f"{greeting}\n\n"
            f"{company_name} has issued API credentials for {vendor_name}. Enter "
            "them in your CRM's API settings so it can send service tickets to us.\n\n"
            f"API base URL: {base}\n"
            f"Client ID: {client_id}\n"
            f"Client secret: {client_secret}\n\n"
            "Keep the client secret safe. It cannot be shown again; if it is lost "
            f"or exposed, ask {company_name} to replace the credential.\n\n"
            f"If you were not expecting this, tell {company_name} and do not use it.\n"
        )
        return await acs_email.send(
            to=to,
            display_name=full_name,
            subject=subject,
            html=html,
            plain_text=plain_text,
            what="api credential",
        )
    except Exception as exc:  # noqa: BLE001 - see the docstring
        # Names the recipient and the reason. NEVER the secret.
        logger.exception("Could not build the API credential email for %s", to)
        return EmailSendResult.failure(f"Could not build the email: {exc}")
