"""The account emails. One function per message, each one never raising.

This is the single helper every account-creating slice calls — company users,
vendors, vendor portal users and company admins — so the decision to put a
password in an email lives in exactly one place. `send_password_reset_code` is
the other half of that decision: the way somebody gets back in without a manager.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from app.core.config import settings
from app.emails.render import render
from app.integrations import acs_email
from app.integrations.acs_email import EmailSendResult

logger = logging.getLogger(__name__)


def _sign_in_url() -> str:
    return f"{settings.CONSOLE_LINK_BASE.rstrip('/')}/login"


async def send_temporary_password(
    *,
    to: str,
    full_name: str | None,
    company_name: str,
    role_label: str,
    temporary_password: str,
) -> EmailSendResult:
    """Send a new (or reissued) temporary password. Never raises.

    The company is a PARAMETER, never the literal "Reliance GreenTech": this
    platform is multi-tenant and one sender serves every company on it, which is
    the same argument `whatsapp.build_invite_payload` already makes.

    Rendering is inside the try with the send. A KeyError from a template typo
    must not 500 a creation that has already committed — the account would
    exist, the caller would see a 500, and nobody would know a password had been
    issued. Same reasoning as the broad catch in `blob.signed_url`.
    """
    subject = f"Your {company_name} account is ready"
    greeting = f"Hello {full_name}," if full_name else "Hello,"

    try:
        html = render(
            "account_ready",
            subject=subject,
            company=company_name,
            greeting=greeting,
            role_label=role_label,
            email=to,
            temporary_password=temporary_password,
            sign_in_url=_sign_in_url(),
            year=datetime.now(timezone.utc).year,
        )
        # A real alternative, not an empty part: some clients render only this,
        # and a multipart message with a blank text part scores worse with spam
        # filters — which matters on a managed azurecomm.net domain.
        plain_text = (
            f"{greeting}\n\n"
            f"You have been added to {company_name} as {role_label}.\n\n"
            f"Email: {to}\n"
            f"Temporary password: {temporary_password}\n\n"
            f"Sign in: {_sign_in_url()}\n\n"
            "Change this password as soon as you sign in "
            "(Account > Change password).\n\n"
            "If you were not expecting this, tell your administrator and do not "
            "sign in.\n"
        )
        return await acs_email.send(
            to=to,
            display_name=full_name,
            subject=subject,
            html=html,
            plain_text=plain_text,
            what="temporary password",
        )
    except Exception as exc:  # noqa: BLE001 - see the docstring
        # Names the recipient and the reason. NEVER the password.
        logger.exception("Could not build the temporary-password email for %s", to)
        return EmailSendResult.failure(f"Could not build the email: {exc}")


async def send_password_reset_code(
    *,
    to: str,
    full_name: str | None,
    company_name: str,
    code: str,
    expires_minutes: int,
) -> EmailSendResult:
    """Send a one-time code for a forgotten console password. Never raises.

    The same shape as `send_temporary_password` above, and for the same reasons:
    the company is a PARAMETER because one sender serves every company on this
    platform, and rendering sits inside the try because the OTP row is already
    written by the time this is called — a template typo must degrade to "we
    could not send it", not 500 a request that has already spent a throttle slot.

    No link and no button. The tab that asked for the code is still open, so a
    link buys nothing, and a password email that trains people to click through
    to a sign-in page is the exact shape of the phishing mail we would rather
    they ignored.

    The rule that binds every caller: **the code is never logged**, exactly as
    the temporary password is not. `otp_service._echo` is the one exception, and
    it is gated on OTP_DEV_ECHO, which production refuses to boot with.
    """
    subject = f"Your {company_name} password reset code"
    greeting = f"Hello {full_name}," if full_name else "Hello,"

    try:
        html = render(
            "password_reset_code",
            subject=subject,
            company=company_name,
            greeting=greeting,
            code=code,
            expires_minutes=expires_minutes,
            year=datetime.now(timezone.utc).year,
        )
        plain_text = (
            f"{greeting}\n\n"
            f"Somebody asked to reset the password for your {company_name} "
            "account.\n\n"
            f"Your code: {code}\n\n"
            f"It expires in {expires_minutes} minutes and can be used once.\n\n"
            f"Nobody from {company_name} will ever ask you for this code.\n\n"
            "If you did not ask for this, you can ignore this email — your "
            "password has not changed.\n"
        )
        return await acs_email.send(
            to=to,
            display_name=full_name,
            subject=subject,
            html=html,
            plain_text=plain_text,
            what="password reset code",
        )
    except Exception as exc:  # noqa: BLE001 - see the docstring
        # Names the recipient and the reason. NEVER the code.
        logger.exception("Could not build the password-reset email for %s", to)
        return EmailSendResult.failure(f"Could not build the email: {exc}")
