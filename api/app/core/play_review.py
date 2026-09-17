"""The one sign-in Google Play's reviewers can use.

A technician signs in with a code sent on WhatsApp to their registered phone,
and a reviewer at Google has no such phone. Play's "App access" declaration
requires a way in, so ONE number, `PLAY_REVIEW_PHONE`, accepts ONE fixed code,
`PLAY_REVIEW_CODE`, and is never sent anything.

Three things stop that from being a back door:

* the number must be `+911…`, which no Indian subscriber can hold (see
  `scripts/seed/guards.py`), so it can never be a real person's account;
* the account must belong to the review company, found by `COMPANY_SLUG`, so a
  number mistakenly pointed at another tenant's technician gets an ordinary
  WhatsApp send instead of a fixed code;
* a missing or malformed setting switches the whole thing off. It is not a
  startup refusal: a bad value here must never take the API down.

Everything else about the code is unchanged. It expires, it is throttled, it is
burned on use, and five wrong guesses spend it — so the fixed code is guessed no
faster than any other.

The company and its data are built by `python -m app.scripts.seed_play_review`,
and `cleanup_db` never deletes it.
"""

import re
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.company import Company
from app.models.membership import Membership

#: How the review company is recognised in every database. A slug rather than an
#: id, because the same company has a different id in development and production.
COMPANY_SLUG = "rgt-play-review"
COMPANY_NAME = "RGT Play Review"
#: Its ticket and technician codes read `DEMO-INST-0001`, and it leaves `RGT`
#: free for the real company.
COMPANY_CODE = "DEMO"

#: What `otp_codes.sent_channel` records for a code that was never sent.
CHANNEL = "play_review"

_UNREACHABLE = re.compile(r"^\+911\d{9}$")


def review_phone() -> str | None:
    """The configured reviewer number, or None when the feature is off."""
    phone = settings.PLAY_REVIEW_PHONE.strip()
    code = settings.PLAY_REVIEW_CODE.strip()
    if not phone or not code:
        return None
    if not _UNREACHABLE.match(phone):
        return None
    if not (code.isdigit() and len(code) == settings.OTP_LENGTH):
        return None
    return phone


async def fixed_code_for(
    session: AsyncSession, *, phone: str, user_id: uuid.UUID | None
) -> str | None:
    """The fixed code to issue instead of a random one, or None to send as usual."""
    configured = review_phone()
    if configured is None or user_id is None or phone != configured:
        return None
    in_review_company = await session.scalar(
        select(Membership.id)
        .join(Company, Company.id == Membership.company_id)
        .where(
            Membership.user_id == user_id,
            Membership.deleted_at.is_(None),
            func.lower(Company.slug) == COMPANY_SLUG,
            Company.deleted_at.is_(None),
        )
        .limit(1)
    )
    return settings.PLAY_REVIEW_CODE.strip() if in_review_company else None
