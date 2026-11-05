"""Emailing the documents to each company's Admins (Epic 1.7).

Documents are born `email_status = 'pending'`. The sweep below turns them into
`sent`, `failed` or `skipped`:

  * **Batched.** It waits two minutes after a document is born, so a burst (a
    bulk closure, a backfill) becomes a few digests instead of a hundred emails,
    and one email carries at most `MAX_PER_EMAIL` documents.
  * **To the company's active Admins** (users with the `admin` role and an
    email), each getting the same digest - nobody has to forward it.
  * **`skipped`** when email is not configured on this server or the company has
    no Admin with an address: not a failure anybody can fix by retrying.
  * **`failed`** when ACS refused. NOT retried automatically - a retry loop on
    a bad address is how an inbox gets flooded. A superadmin (or the company's
    Admin) re-queues documents with `requeue()`, which puts them back to
    `pending`.

Delivery is "ACS accepted it", not "it arrived" - see `integrations/acs_email`.
"""

import datetime
import logging
import uuid

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.brand import company_name as brand_company_name
from app.core.deps import Principal
from app.core.errors import AppError
from app.emails.documents import MAX_PER_EMAIL, DocumentLine, send_documents
from app.features.transactions.service import day_start, scope
from app.integrations import acs_email
from app.models.company import Company
from app.models.membership import Membership
from app.models.role import ADMIN
from app.models.transaction_document import TransactionDocument
from app.models.user import User

logger = logging.getLogger(__name__)

#: A document must be this old before it is emailed, so a burst batches.
SETTLE = datetime.timedelta(minutes=2)
#: Documents handled per sweep tick; the rest wait for the next tick.
PER_SWEEP = 200


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


async def _admins(db: AsyncSession, company_id: uuid.UUID) -> list[tuple[str, str | None]]:
    rows = await db.execute(
        select(User.email, User.full_name)
        .join(Membership, Membership.user_id == User.id)
        .where(
            Membership.company_id == company_id,
            Membership.is_active.is_(True),
            Membership.deleted_at.is_(None),
            User.role == ADMIN,
            User.deleted_at.is_(None),
            User.email.is_not(None),
        )
    )
    return [(r.email, r.full_name) for r in rows]


async def sweep_document_emails(db: AsyncSession) -> int:
    """Send pending documents' digests. Returns how many documents were settled."""
    cutoff = _now() - SETTLE
    docs = (
        await db.scalars(
            select(TransactionDocument)
            .where(
                TransactionDocument.email_status == "pending",
                TransactionDocument.created_at <= cutoff,
            )
            .order_by(TransactionDocument.company_id, TransactionDocument.issued_at)
            .limit(PER_SWEEP)
        )
    ).all()
    if not docs:
        return 0

    by_company: dict[uuid.UUID, list[TransactionDocument]] = {}
    for d in docs:
        by_company.setdefault(d.company_id, []).append(d)

    settled = 0
    for company_id, group in by_company.items():
        ids = [d.id for d in group]
        admins = await _admins(db, company_id) if acs_email.is_configured() else []
        if not admins:
            await _mark(db, ids, "skipped")
            settled += len(ids)
            continue
        name = brand_company_name(
            await db.scalar(select(Company.name).where(Company.id == company_id))
        )
        ok_all = True
        for start in range(0, len(group), MAX_PER_EMAIL):
            chunk = group[start : start + MAX_PER_EMAIL]
            lines = [
                DocumentLine(d.number, d.doc_type, d.party_label, d.description, d.amount_paise)
                for d in chunk
            ]
            chunk_ok = True
            for address, full_name in admins:
                result = await send_documents(
                    to=address, full_name=full_name, company_name=name, lines=lines
                )
                if not result.ok:
                    chunk_ok = False
                    logger.warning("Documents email to %s failed: %s", address, result.error)
            await _mark(db, [d.id for d in chunk], "sent" if chunk_ok else "failed")
            ok_all = ok_all and chunk_ok
        settled += len(ids)
    return settled


async def _mark(db: AsyncSession, ids: list[uuid.UUID], status: str) -> None:
    await db.execute(
        update(TransactionDocument)
        .where(TransactionDocument.id.in_(ids))
        .values(
            email_status=status,
            emailed_at=_now() if status == "sent" else None,
        )
    )
    await db.commit()


async def requeue(
    db: AsyncSession,
    principal: Principal,
    *,
    company_id: uuid.UUID | None,
    start: datetime.date | None,
    end: datetime.date | None,
    document_id: uuid.UUID | None,
    only_unsent: bool,
) -> int:
    """Put documents back to `pending` so the sweep emails them again.

    Allowed to anyone `scope()` lets read them - superadmin everywhere, a
    company's Admin / NH for their own - but never for vendors or franchisees:
    the email goes to the COMPANY's Admins, so re-sending is the company's call.
    """
    if not principal.is_superadmin and principal.role not in (ADMIN, "national_head"):
        raise AppError(403, "FORBIDDEN", "Only the company or the platform can re-send documents.")
    scoped = await scope(db, principal, company_id)
    conds = list(scoped.conditions)
    if document_id:
        conds.append(TransactionDocument.id == document_id)
    if start:
        conds.append(TransactionDocument.issued_at >= day_start(start))
    if end:
        conds.append(
            TransactionDocument.issued_at < day_start(end + datetime.timedelta(days=1))
        )
    if only_unsent:
        conds.append(TransactionDocument.email_status.in_(("failed", "skipped")))
    if not document_id and not (start or end):
        raise AppError(422, "RANGE_REQUIRED", "Choose a date range to re-send.")
    result = await db.execute(
        update(TransactionDocument)
        .where(*conds)
        .values(email_status="pending", emailed_at=None)
    )
    await db.commit()
    return int(result.rowcount or 0)
