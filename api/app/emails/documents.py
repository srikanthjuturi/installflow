"""The documents email: the numbered paper, to the people who keep the books (Epic 1.7).

One function, never raising -- a delivery problem is RETURNED so the caller can
record `failed` against the documents and retry, never allowed to undo money that
has already been committed. Same contract as `emails/account.py`.
"""

from __future__ import annotations

import html
import logging
from dataclasses import dataclass
from datetime import datetime, timezone

from app.core.money import rupees
from app.emails.render import Raw, render
from app.integrations import acs_email
from app.integrations.acs_email import EmailSendResult

logger = logging.getLogger(__name__)

#: How many documents one email carries. More than this is a statement, not a
#: notification; the rest wait for the next sweep.
MAX_PER_EMAIL = 25

TYPE_LABELS = {
    "sales_invoice": "Sales Invoice",
    "receipt": "Receipt",
    "payment": "Payment",
    "debit_note": "Debit Note",
    "credit_note": "Credit Note",
    "purchase_note": "Purchase Note",
}


@dataclass(frozen=True)
class DocumentLine:
    number: str
    doc_type: str
    party: str
    description: str
    amount_paise: int


def _row(line: DocumentLine) -> str:
    e = html.escape
    return (
        "<tr>"
        '<td style="padding:10px 12px; font-size:14px; color:#1c1d26; border-top:1px solid #e2e3ec;">'
        f"<strong>{e(line.number)}</strong><br />"
        f'<span style="font-size:12px; color:#6b6d80;">{e(TYPE_LABELS.get(line.doc_type, line.doc_type))}</span></td>'
        '<td style="padding:10px 12px; font-size:14px; color:#3f4150; border-top:1px solid #e2e3ec;">'
        f"{e(line.party)}<br />"
        f'<span style="font-size:12px; color:#6b6d80;">{e(line.description)}</span></td>'
        '<td align="right" style="padding:10px 12px; font-size:14px; color:#1c1d26; border-top:1px solid #e2e3ec; white-space:nowrap;">'
        f"{e(rupees(line.amount_paise))}</td>"
        "</tr>"
    )


async def send_documents(
    *,
    to: str,
    full_name: str | None,
    company_name: str,
    lines: list[DocumentLine],
) -> EmailSendResult:
    """Email `lines` (already capped to `MAX_PER_EMAIL`). Never raises."""
    count = len(lines)
    noun = "document" if count == 1 else "documents"
    subject = (
        f"{company_name}: {lines[0].number}"
        if count == 1
        else f"{company_name}: {count} new {noun}"
    )
    greeting = f"Hello {full_name}," if full_name else "Hello,"
    intro = (
        f"{count} new {noun} {'was' if count == 1 else 'were'} issued on your account. "
        "The amounts below are internal records of money that moved."
    )
    try:
        body = render(
            "documents_issued",
            subject=subject,
            preheader=intro,
            company=company_name,
            heading=f"{count} new {noun}",
            greeting=greeting,
            intro=intro,
            rows=Raw("".join(_row(l) for l in lines)),
            footer="Open Transactions in the console to see proofs and download statements.",
            year=datetime.now(timezone.utc).year,
        )
        plain = (
            f"{greeting}\n\n{intro}\n\n"
            + "\n".join(
                f"{l.number}  {TYPE_LABELS.get(l.doc_type, l.doc_type)}  {l.party}  "
                f"{rupees(l.amount_paise)}  {l.description}"
                for l in lines
            )
            + "\n\nOpen Transactions in the console to see proofs and download statements.\n"
        )
        return await acs_email.send(
            to=to,
            display_name=full_name,
            subject=subject,
            html=body,
            plain_text=plain,
            what="documents",
        )
    except Exception as exc:  # noqa: BLE001 - a template typo must not break a sweep
        logger.exception("Could not build the documents email")
        return EmailSendResult.failure(str(exc))
