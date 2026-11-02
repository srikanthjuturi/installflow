"""Issue numbered documents for money that moved BEFORE documents existed (Epic 1.3).

    python -m app.scripts.backfill_documents            # dry run: counts only
    python -m app.scripts.backfill_documents --apply    # write them
    python -m app.scripts.backfill_documents --apply --company <slug>

Idempotent: `core.documents.issue` returns the document already issued for a
source row, so re-running (or running after live traffic has started issuing
its own) writes nothing twice. Each company is processed oldest-first so its
numbers read in the order the money moved, and each company commits on its own,
so a failure leaves earlier companies done and this one untouched.

⚠ Like every script here it hits the database named by the environment: the
DEVELOPMENT one unless `CONFIRM_PROD` / `POSTGRES_DB` are overridden. Run it on
production only AFTER the release that issues documents live is published,
or the numbers it hands out and the live ones will interleave out of order.

Sources, and the document each becomes:

    vendor_credit_entries  charge   -> Sales Invoice   (vendor)
    vendor_credit_entries  payment  -> Receipt         (vendor)
    credit_recharges       credited -> Purchase Note + Payment   (platform)
    redemptions            settled  -> Payment         (technician)
    ledger_entries         reversal -> Credit Note     (technician)

Franchise settlements are new with documents and have nothing to backfill.
"""

import argparse
import asyncio
import selectors
import sys
import uuid

from sqlalchemy import select

from app.core import documents
from app.core.database import AsyncSessionLocal
from app.models.company import Company
from app.models.credits import CreditRecharge
from app.models.ledger import LedgerEntry
from app.models.membership import Membership
from app.models.redemption import Redemption
from app.models.technician import TechnicianProfile
from app.models.ticket import Ticket
from app.models.user import User
from app.models.vendor import Vendor
from app.models.vendor_credits import VendorCreditEntry, VendorPayment


async def _technician_names(db, company_id: uuid.UUID) -> dict[uuid.UUID, str]:
    rows = await db.execute(
        select(TechnicianProfile.id, User.full_name)
        .join(Membership, Membership.id == TechnicianProfile.membership_id)
        .join(User, User.id == Membership.user_id)
        .where(TechnicianProfile.company_id == company_id)
    )
    return {r.id: (r.full_name or "Technician") for r in rows}


async def backfill_company(db, cid: uuid.UUID) -> dict[str, int]:
    done = {"sales_invoice": 0, "receipt": 0, "purchase_note": 0, "payment": 0, "credit_note": 0}
    vendors = {
        r.id: r.name
        for r in await db.execute(select(Vendor.id, Vendor.name).where(Vendor.company_id == cid))
    }
    codes = {
        r.id: r.code
        for r in await db.execute(select(Ticket.id, Ticket.code).where(Ticket.company_id == cid))
    }
    techs = await _technician_names(db, cid)

    # One chronological stream per company so numbers follow the money.
    events: list[tuple] = []

    for e in await db.scalars(select(VendorCreditEntry).where(VendorCreditEntry.company_id == cid)):
        events.append((e.created_at, "vendor_entry", e))
    for r in await db.scalars(
        select(CreditRecharge).where(
            CreditRecharge.company_id == cid, CreditRecharge.confirmed_at.is_not(None)
        )
    ):
        events.append((r.confirmed_at, "recharge", r))
    for r in await db.scalars(
        select(Redemption).where(
            Redemption.company_id == cid, Redemption.confirmed_at.is_not(None)
        )
    ):
        events.append((r.confirmed_at, "redemption", r))
    for r in await db.scalars(
        select(LedgerEntry).where(LedgerEntry.company_id == cid, LedgerEntry.kind == "reversal")
    ):
        events.append((r.created_at, "reversal", r))
    events.sort(key=lambda ev: ev[0])

    payments = {
        p.id: p
        for p in await db.scalars(select(VendorPayment).where(VendorPayment.company_id == cid))
    }

    for at, kind, row in events:
        if kind == "vendor_entry" and row.kind == "charge":
            await documents.issue(
                db,
                company_id=cid,
                doc_type="sales_invoice",
                party_kind="vendor",
                party_id=row.vendor_id,
                party_label=vendors.get(row.vendor_id, "Vendor"),
                amount_paise=row.amount_paise,
                source_kind="vendor_credit_entry",
                source_id=row.id,
                ticket_id=row.ticket_id,
                description=f"Ticket {codes.get(row.ticket_id, 'ticket')} closed",
                issued_at=at,
            )
            done["sales_invoice"] += 1
        elif kind == "vendor_entry" and row.kind == "payment":
            pay = payments.get(row.payment_id)
            await documents.issue(
                db,
                company_id=cid,
                doc_type="receipt",
                party_kind="vendor",
                party_id=row.vendor_id,
                party_label=vendors.get(row.vendor_id, "Vendor"),
                amount_paise=row.amount_paise,
                source_kind="vendor_credit_entry",
                source_id=row.id,
                description=f"Payment {pay.code if pay else ''} received".replace("  ", " "),
                issued_at=at,
                proof_blob_name=pay.proof_blob_name if pay else None,
                proof_reference=pay.utr if pay else None,
            )
            done["receipt"] += 1
        elif kind == "recharge":
            for doc_type in ("purchase_note", "payment"):
                await documents.issue(
                    db,
                    company_id=cid,
                    doc_type=doc_type,
                    party_kind="platform",
                    party_id=None,
                    party_label="Platform",
                    amount_paise=row.amount_paise,
                    source_kind="credit_entry",
                    source_id=row.id,
                    description=f"Credit recharge {row.code}",
                    issued_at=at,
                    proof_blob_name=row.proof_blob_name if doc_type == "payment" else None,
                    proof_reference=row.utr if doc_type == "payment" else None,
                )
                done[doc_type] += 1
        elif kind == "redemption":
            await documents.issue(
                db,
                company_id=cid,
                doc_type="payment",
                party_kind="technician",
                party_id=row.technician_id,
                party_label=techs.get(row.technician_id, "Technician"),
                amount_paise=row.amount_paise,
                source_kind="redemption",
                source_id=row.id,
                description=f"Redemption {row.code} paid",
                issued_at=at,
                proof_blob_name=row.proof_blob_name,
                proof_reference=row.utr,
            )
            done["payment"] += 1
        elif kind == "reversal":
            await documents.issue(
                db,
                company_id=cid,
                doc_type="credit_note",
                party_kind="technician",
                party_id=row.technician_id,
                party_label=techs.get(row.technician_id, "Technician"),
                amount_paise=row.amount_paise,
                source_kind="ledger_entry",
                source_id=row.id,
                ticket_id=row.ticket_id,
                description=f"Penalty reversed on {codes.get(row.ticket_id, 'ticket')}",
                issued_at=at,
                note=row.reason,
            )
            done["credit_note"] += 1
    return done


async def run(apply: bool, slug: str | None) -> int:
    async with AsyncSessionLocal() as db:
        stmt = select(Company).where(Company.deleted_at.is_(None)).order_by(Company.created_at)
        if slug:
            stmt = stmt.where(Company.slug == slug)
        # Plain (id, slug) pairs: a commit/rollback below expires ORM instances.
        companies = [(c.id, c.slug) for c in (await db.scalars(stmt)).all()]
        if not companies:
            print("No matching companies.")
            return 1
        for company_id, company_slug in companies:
            counts = await backfill_company(db, company_id)
            line = ", ".join(f"{k}={v}" for k, v in counts.items())
            if apply:
                await db.commit()
                print(f"{company_slug}: issued (already-issued skipped) -- {line}")
            else:
                await db.rollback()
                print(f"{company_slug}: WOULD issue up to -- {line}")
    if not apply:
        print("\nDry run - nothing written. Re-run with --apply.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true", help="write the documents")
    parser.add_argument("--company", help="only this company slug")
    args = parser.parse_args()
    return asyncio.run(
        run(args.apply, args.company),
        loop_factory=lambda: asyncio.SelectorEventLoop(selectors.SelectSelector()),
    )


if __name__ == "__main__":
    sys.exit(main())
