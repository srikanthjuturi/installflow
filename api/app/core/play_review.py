"""Sign-ins that need no phone to actually reach anyone.

A technician signs in with a code sent on WhatsApp to their registered phone.
Two situations have nobody real behind that phone: a reviewer at Google, whose
"App access" declaration requires a way in, and a client walking through a
demo, who is not going to be handed our team's own numbers. Each gets ONE
number that accepts ONE fixed code and is never sent anything — the Play
reviewer's `PLAY_REVIEW_PHONE` / `PLAY_REVIEW_CODE`, the demo's
`DEMO_REVIEW_PHONE` / `DEMO_REVIEW_CODE`.

Three things stop either from being a back door:

* the number must be `+911…`, which no Indian subscriber can hold (see
  `scripts/seed/guards.py`), so it can never be a real person's account;
* the account must belong to that ENTRY's own company, found by slug, so a
  number mistakenly pointed at another tenant's technician gets an ordinary
  WhatsApp send instead of a fixed code — the Play number cannot unlock a
  technician in the demo company, or the reverse;
* a missing or malformed setting switches that entry off. Not a startup
  refusal: a bad value here must never take the API down.

Everything else about the code is unchanged. It expires, it is throttled, it is
burned on use, and five wrong guesses spend it — so a fixed code is guessed no
faster than any other.

The Play reviewer's company is built by `python -m app.scripts.seed_play_review`
and `cleanup_db` never deletes it. The demo company is built by
`python -m app.scripts.seed_demo` and IS deleted by a clean — re-seed after one.
"""

import dataclasses
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

#: The demo company `seed_demo.py` builds — see its `NAMES.company`.
DEMO_COMPANY_SLUG = "greentech-demo-services"
DEMO_CHANNEL = "demo_review"

_UNREACHABLE = re.compile(r"^\+911\d{9}$")


@dataclasses.dataclass(frozen=True)
class _Entry:
    phone: str
    code: str
    company_slug: str
    channel: str


def _configured(phone: str, code: str) -> tuple[str, str] | None:
    """`(phone, code)` if both are well-formed, else None — that entry is off."""
    phone = phone.strip()
    code = code.strip()
    if not phone or not code:
        return None
    if not _UNREACHABLE.match(phone):
        return None
    if not (code.isdigit() and len(code) == settings.OTP_LENGTH):
        return None
    return phone, code


def _entries() -> list[_Entry]:
    entries: list[_Entry] = []
    play = _configured(settings.PLAY_REVIEW_PHONE, settings.PLAY_REVIEW_CODE)
    if play is not None:
        entries.append(_Entry(*play, company_slug=COMPANY_SLUG, channel=CHANNEL))
    demo = _configured(settings.DEMO_REVIEW_PHONE, settings.DEMO_REVIEW_CODE)
    if demo is not None:
        entries.append(_Entry(*demo, company_slug=DEMO_COMPANY_SLUG, channel=DEMO_CHANNEL))
    return entries


def review_phone() -> str | None:
    """The configured Play reviewer number, or None when that entry is off.

    Play-specific on purpose: `seed_play_review.py` needs exactly this one to
    know which technician to build, and has no reason to know about the demo.
    """
    play = _configured(settings.PLAY_REVIEW_PHONE, settings.PLAY_REVIEW_CODE)
    return play[0] if play else None


async def fixed_code_for(
    session: AsyncSession, *, phone: str, user_id: uuid.UUID | None
) -> tuple[str, str] | None:
    """The `(code, channel)` to issue instead of a random one, or None to send
    as usual. Checks every configured entry — at most one can ever match, since
    each is a distinct `+911…` number."""
    if user_id is None:
        return None
    for entry in _entries():
        if phone != entry.phone:
            continue
        in_company = await session.scalar(
            select(Membership.id)
            .join(Company, Company.id == Membership.company_id)
            .where(
                Membership.user_id == user_id,
                Membership.deleted_at.is_(None),
                func.lower(Company.slug) == entry.company_slug,
                Company.deleted_at.is_(None),
            )
            .limit(1)
        )
        return (entry.code, entry.channel) if in_company else None
    return None
