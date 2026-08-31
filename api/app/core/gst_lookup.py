"""The GSTIN registry lookup, shared by the two forms that ask for a GSTIN.

`app/core/gst.py` next door owns the rule that one GSTIN belongs to one legal
entity. This owns the other half: what the REGISTRY says about a GSTIN, which
both the vendor form and the superadmin's company form fill themselves from.

It lives in core rather than in either slice for the reason `gst.py` already
gives — hard rule 4 forbids `companies` and `vendors` importing each other, and
this is one behaviour serving both. The two routers differ only in who may call
them, which is exactly the part that should NOT be shared:

    POST /vendors/gstin-lookup    vendors.edit + National Head and above
    POST /companies/gstin-lookup  superadmin

Both spend a unit of a metered subscription per call, which is why each is
gated on the people who can act on the answer rather than on anyone signed in.

The transport and the mapping are `app.integrations.gstzen`; this is the part
that has a database and a principal, so the alert below can find somebody to
tell when the subscription stops answering.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.schemas import AppModel
from app.core.statutory import GstNumber
from app.emails import send_gstin_lookup_unavailable
from app.integrations import gstzen
from app.models.company import Company
from app.models.membership import Membership
from app.models.role import NATIONAL_HEAD, REGIONAL_HEAD
from app.models.user import User

logger = logging.getLogger(__name__)


class GstinLookupRequest(BaseModel):
    """Ask the GST registry about one GSTIN.

    `GstNumber` rather than a plain string, so a malformed value is a 422 that
    never leaves this process — a metered subscription should not be spent
    proving that 14 characters are not a GSTIN.
    """

    gstin: GstNumber


class GstinLookupOut(AppModel):
    """What the registry said, as a form needs it.

    **200 in every case, with the answer in `outcome`** — not a 4xx or a 502 for
    the two unhappy paths. The same shape as `emailStatus` on `POST /vendors`,
    and for the same reason: the console renders the difference inline, and a
    thrown error would be reported a second time by the global toaster while the
    form is trying to say something quieter and more specific.

    `outcome` is the discriminator:

    * `found` — every field below may be filled.
    * `not_registered` — a real answer. The console blocks the save.
    * `unavailable` — we could not ask. The console blocks NOTHING.

    Genuine faults — no session, a malformed body — stay ordinary errors. The
    raw upstream payload is never forwarded.
    """

    outcome: str
    #: Why, when `outcome` is not `found`. Null otherwise.
    reason: str | None = None

    #: The trading name, falling back to the legal name — what goes in the box.
    name: str | None = None
    #: Sent ONLY when it differs from `name`, so the console can show the
    #: difference without having to compare two strings to find out there isn't
    #: one. Null is the normal case.
    legalName: str | None = None
    pan: str | None = None
    gstCompanyStatus: str | None = None
    #: Set only on a cancelled registration. Shown beside the status, not stored.
    cancellationDate: str | None = None

    address: str | None = None
    city: str | None = None
    state: str | None = None
    pincode: str | None = None


#: When each company was last told its GSTIN lookups have stopped.
#:
#: In PROCESS memory, deliberately: an alert throttle is not worth a table and a
#: migration, and the failure mode is mild in both directions — a restart may
#: send one extra email, and each gunicorn worker keeps its own clock, so a
#: four-worker deployment can send up to four in a day. Both are better than the
#: alternative this replaces, which was one email per keystroke-completed GSTIN.
_ALERTED_AT: dict[uuid.UUID, datetime] = {}

#: Once a day. Long enough not to nag about a subscription nobody can renew at
#: 11pm, short enough that the alert reappears if it is ignored.
_ALERT_EVERY = timedelta(hours=24)


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _alert_heads(
    db: AsyncSession, company_id: uuid.UUID | None, reason: str
) -> None:
    """Email a company's National and Regional Heads that autofill has stopped.

    Only for a SUBSCRIPTION failure — see `gstzen.GstinLookup.subscription_issue`.
    A timeout fixes itself and is not worth anybody's inbox.

    Per company, even though the subscription is platform-wide: every tenant's
    vendor form has stopped autofilling, and each one's heads are the people who
    will otherwise be told "the form is broken" by somebody typing an address.

    A SUPERADMIN has no company, so there is nobody to write to — the warning
    goes to the log instead. That is not a gap: the superadmin is the person who
    renews the subscription, and they are looking at the screen that just failed.

    Never raises. This runs inside a request that is ALREADY degraded; failing to
    send the alert must not also turn a soft "we could not check that" into a
    500 on the operator's screen.
    """
    if company_id is None:
        logger.warning("GSTIN lookup unavailable for a superadmin: %s", reason)
        return

    now = _now()
    last = _ALERTED_AT.get(company_id)
    if last is not None and now - last < _ALERT_EVERY:
        return
    # Stamped BEFORE the sends, so a slow mailbox cannot let a second request
    # through the gate behind this one.
    _ALERTED_AT[company_id] = now

    try:
        rows = await db.execute(
            select(User.email, User.full_name)
            .join(Membership, Membership.user_id == User.id)
            .where(
                Membership.company_id == company_id,
                Membership.deleted_at.is_(None),
                Membership.is_active.is_(True),
                User.role.in_((NATIONAL_HEAD, REGIONAL_HEAD)),
                User.is_active.is_(True),
                User.deleted_at.is_(None),
                User.email.isnot(None),
            )
        )
        recipients = [(email, name) for email, name in rows if email]
        if not recipients:
            logger.warning(
                "GSTIN lookup is unavailable and company %s has no head to tell",
                company_id,
            )
            return

        company_name = await db.scalar(
            select(Company.name).where(Company.id == company_id)
        )
        sent = 0
        for email, full_name in recipients:
            result = await send_gstin_lookup_unavailable(
                to=email,
                full_name=full_name,
                company_name=company_name or "Reliance GreenTech",
                reason=reason,
            )
            if result.ok:
                sent += 1
            else:
                # Worth its own line: an alert nobody receives is worse than no
                # alert, because the log then reads as though somebody was told.
                # Empty ACS_* settings land here, exactly as they do elsewhere.
                logger.warning(
                    "Could not alert %s about the GSTIN lookup: %s", email, result.error
                )
        logger.warning(
            "GSTIN lookup unavailable (%s) — alerted %d of %d head(s) of company %s",
            reason,
            sent,
            len(recipients),
            company_id,
        )
    except Exception:  # noqa: BLE001 - see the docstring
        logger.exception("Could not alert the heads about the GSTIN lookup")


async def lookup_gstin_service(
    db: AsyncSession, company_id: uuid.UUID | None, gstin: str
) -> GstinLookupOut:
    """What the GST registry says about a GSTIN — the forms' autofill.

    Reads a public registry rather than our own data, so there is no tenancy
    question in the answer; `company_id` is here only so a subscription failure
    can reach somebody, and is None for a superadmin.

    Never raises for an upstream failure — see `app.integrations.gstzen`. Only
    the returned FIELDS cross this boundary; the provider's payload does not.
    """
    result = await gstzen.lookup(gstin)

    # The subscription being spent or lapsed is invisible from the console — the
    # form just quietly stops filling itself in — so it is told to somebody.
    if result.subscription_issue:
        await _alert_heads(db, company_id, result.reason or "No reason was given")

    return GstinLookupOut(
        outcome=result.outcome,
        reason=result.reason,
        name=result.name,
        legalName=result.legal_name,
        pan=result.pan,
        gstCompanyStatus=result.company_status,
        cancellationDate=result.cancellation_date,
        address=result.address,
        city=result.city,
        state=result.state,
        pincode=result.pincode,
    )
