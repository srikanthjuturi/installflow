"""A party's debit / credit statement over numbered documents (Epic 1.6).

Pure arithmetic and CSV, no database -- `features/transactions/service.py` loads
the rows and calls this. Same split as `core/statements.py`, whose `csv_safe`
and `rupees_plain` this reuses so one rule decides what a cell may start with.

## Sign convention

From the PARTY'S account in the company's books (see `models/transaction_document.py`):
a `debit` document raises what the party owes the company, a `credit` document
reduces it. The running balance is therefore `debit - credit`, accumulated:

    positive   the party owes the company
    negative   the company owes the party

For the PLATFORM party in a company's books the same arithmetic applies, so a
credit recharge (Purchase Note, credit) followed by its Payment (debit) nets to
zero, and an unpaid purchase shows as the company owing the platform.
"""

import csv
import datetime
import io
from dataclasses import dataclass

from app.core.statements import IST, csv_safe, rupees_plain

DOC_LABELS = {
    "sales_invoice": "Sales Invoice",
    "receipt": "Receipt",
    "payment": "Payment",
    "debit_note": "Debit Note",
    "credit_note": "Credit Note",
    "purchase_note": "Purchase Note",
}


@dataclass(frozen=True)
class Line:
    number: str
    doc_type: str
    issued_at: datetime.datetime
    description: str
    effect: str  # 'debit' | 'credit'
    amount_paise: int
    reference: str | None = None


@dataclass(frozen=True)
class StatementLine:
    line: Line
    debit_paise: int
    credit_paise: int
    balance_paise: int


@dataclass(frozen=True)
class Statement:
    opening_paise: int
    lines: list[StatementLine]
    total_debit_paise: int
    total_credit_paise: int

    @property
    def closing_paise(self) -> int:
        return self.lines[-1].balance_paise if self.lines else self.opening_paise


def signed(effect: str, amount_paise: int) -> int:
    """+ for a debit, - for a credit."""
    return amount_paise if effect == "debit" else -amount_paise


def build(opening_paise: int, lines: list[Line]) -> Statement:
    """Running balance over `lines`, which MUST already be in issue order."""
    balance = opening_paise
    out: list[StatementLine] = []
    total_debit = total_credit = 0
    for line in lines:
        balance += signed(line.effect, line.amount_paise)
        debit = line.amount_paise if line.effect == "debit" else 0
        credit = line.amount_paise if line.effect == "credit" else 0
        total_debit += debit
        total_credit += credit
        out.append(StatementLine(line, debit, credit, balance))
    return Statement(opening_paise, out, total_debit, total_credit)


def balance_words(paise: int) -> str:
    if paise > 0:
        return "owes the company"
    if paise < 0:
        return "is owed by the company"
    return "settled"


def _ist(at: datetime.datetime) -> str:
    return at.astimezone(IST).strftime("%d-%b-%Y")


def build_csv(
    *,
    company_name: str,
    party_kind: str,
    party_label: str,
    start: datetime.date,
    end: datetime.date,
    statement: Statement,
) -> str:
    """The whole file as text -- the endpoint adds the BOM and the filename."""
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(["Account statement", csv_safe(company_name)])
    w.writerow(["Party", csv_safe(party_kind.title()), csv_safe(party_label)])
    w.writerow(["Period", start.isoformat(), end.isoformat()])
    w.writerow([])
    w.writerow(["Date", "Number", "Type", "Details", "Reference", "Debit", "Credit", "Balance"])
    w.writerow(["", "", "", "Opening balance", "", "", "", rupees_plain(statement.opening_paise)])
    for sl in statement.lines:
        w.writerow(
            [
                _ist(sl.line.issued_at),
                csv_safe(sl.line.number),
                DOC_LABELS.get(sl.line.doc_type, sl.line.doc_type),
                csv_safe(sl.line.description),
                csv_safe(sl.line.reference or ""),
                rupees_plain(sl.debit_paise) if sl.debit_paise else "",
                rupees_plain(sl.credit_paise) if sl.credit_paise else "",
                rupees_plain(sl.balance_paise),
            ]
        )
    w.writerow(
        [
            "",
            "",
            "",
            "Totals",
            "",
            rupees_plain(statement.total_debit_paise),
            rupees_plain(statement.total_credit_paise),
            "",
        ]
    )
    w.writerow(
        ["", "", "", f"Closing balance ({balance_words(statement.closing_paise)})", "", "", "", rupees_plain(statement.closing_paise)]
    )
    return buf.getvalue()


def filename(party_label: str, start: datetime.date, end: datetime.date) -> str:
    safe = "".join(ch if ch.isalnum() else "-" for ch in party_label).strip("-")[:40] or "party"
    return f"statement-{safe}-{start.isoformat()}-to-{end.isoformat()}.csv"
