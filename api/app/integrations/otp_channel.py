"""How a one-time code reaches a technician.

WhatsApp is the only real channel today and there is no SMS provider contracted,
which means a technician without WhatsApp cannot sign in at all. That is a
business decision, not an oversight — this seam exists so that reversing it
(MSG91, Gupshup, Twilio) is one new class and one line in `resolve_channel`,
not a change to the OTP service.

With nothing configured the code is logged instead of sent, so the whole flow is
walkable in development without Meta credentials.
"""

import logging
from typing import Protocol

from app.integrations import whatsapp
from app.integrations.whatsapp import SendResult

logger = logging.getLogger(__name__)


class OtpChannel(Protocol):
    """Anything that can deliver a code. Must never raise on a send failure."""

    name: str

    async def send(self, phone: str, code: str) -> SendResult: ...


class WhatsAppChannel:
    name = "whatsapp"

    async def send(self, phone: str, code: str) -> SendResult:
        return await whatsapp.send_otp(phone, code)


class LoggingChannel:
    """Development fallback. Writes the code to the server log and nowhere else."""

    name = "log"

    async def send(self, phone: str, code: str) -> SendResult:
        # The only place a code is ever written in clear. Deliberately WARNING
        # so it stands out in a dev log, and unreachable in production because
        # startup refuses to boot without WhatsApp configured there.
        logger.warning("OTP for %s is %s (no delivery channel configured)", phone, code)
        return SendResult(ok=True, message_id=None)


def resolve_channel() -> OtpChannel:
    return WhatsAppChannel() if whatsapp.is_configured() else LoggingChannel()
