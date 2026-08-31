"""Operational alerts — a message about the SYSTEM, not about an account.

`account.py` writes to one person about something they asked for. This writes to
whoever is accountable for a capability that has stopped, whether or not they
were at a keyboard when it did.

The same two rules apply: never raises, and the company is a PARAMETER rather
than the literal "Reliance GreenTech", because one sender serves every company
on this platform.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from app.emails.render import render
from app.integrations import acs_email
from app.integrations.acs_email import EmailSendResult

logger = logging.getLogger(__name__)


async def send_gstin_lookup_unavailable(
    *,
    to: str,
    full_name: str | None,
    company_name: str,
    reason: str,
) -> EmailSendResult:
    """Tell a head that GSTIN autofill has stopped. Never raises.

    Sent only when the GST subscription itself is the problem — spent, lapsed,
    or a credential the provider refuses. A timeout is not worth an email: it
    fixes itself, and an alert that cries wolf is one nobody opens.

    It leads with what still works. The recipient cannot renew a subscription
    from their phone, but they CAN stop somebody escalating "the vendor form is
    broken" — it is not; it is only slower.
    """
    subject = f"{company_name}: GSTIN autofill has stopped"
    greeting = f"Hello {full_name}," if full_name else "Hello,"

    try:
        html = render(
            "gstin_lookup_unavailable",
            subject=subject,
            company=company_name,
            greeting=greeting,
            reason=reason,
            year=datetime.now(timezone.utc).year,
        )
        # A real alternative, not an empty part — see send_temporary_password.
        plain_text = (
            f"{greeting}\n\n"
            "The GST verification service is no longer answering, so the vendor "
            "form can no longer fill in a company's name, PAN, registration "
            "status and address from its GSTIN.\n\n"
            f"What the service said: {reason}\n\n"
            "Nothing is blocked. Vendors can still be added and edited — every "
            "field can be typed in by hand, exactly as before autofill "
            "existed.\n\n"
            "Until the subscription is renewed, a GSTIN is no longer checked "
            "against the registry, so an unregistered number can now be saved "
            "on a vendor.\n\n"
            "Sent once per day while the problem lasts, to the National and "
            f"Regional Heads of {company_name}.\n"
        )
        return await acs_email.send(
            to=to,
            display_name=full_name,
            subject=subject,
            html=html,
            plain_text=plain_text,
            what="GSTIN lookup alert",
        )
    except Exception as exc:  # noqa: BLE001 - an alert must never raise
        logger.exception("Could not build the GSTIN-lookup alert for %s", to)
        return EmailSendResult.failure(f"Could not build the email: {exc}")
