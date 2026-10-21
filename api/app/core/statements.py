"""The monthly employee statement — how payroll reads one technician's month.

Task 06 (§4.9). Money an employee earns is salary money, and payroll does not
read a ledger table; it reads a file. This module turns the employee stream of
`ledger_entries` into that file, and the two statement endpoints
(`franchise_portal.router`, `ledger.router`) both call it — which is also why
the module lives in `core/`: slices never import each other (hard rule 4).

## Which rows belong here

`technician_type` on each row (Task 05 §3.3) is what sorts a technician's
ledger into two streams — `employee` goes on the salary statement, `freelancer`
is redeemable by UPI (T4). The statement reads the EMPLOYEE stream only, and
never `payout`: an employee is never paid per job (T2), so the kind cannot
appear — but read the rule in the query as "everything but payout" rather than
a list of kinds to include, so a kind added in Task 10 or 11 arrives on the
statement the day its writer ships, without this file being edited first.

## A statement is written, not restated

Every row lands in the month it was WRITTEN. A September penalty reversed in
October prints as two lines, in two files. This differs from the Earnings
screen, which treats a reversal as if the charge never happened, deliberately:
payroll has already acted on September's file, and a file that changes after
it was paid is not a record, it is a rumour. The reversal line names what it
undid (`Reverses`) so the clerk can see the pair without hunting.

## The file is a clerk's template, not a report

Fixed preamble, fixed column header, a totals block that lists every kind in
`TOTAL_ORDER` even when zero — because the template does not change shape when
Task 10's travel rows and Task 11's speed rows first appear. Amounts are plain
rupees with two decimals; a debit is positive in the debit column, and only
`Net` carries a sign. ₹ and non-Latin names reach Excel because the bytes are
UTF-8 with BOM — the BOM is added by the endpoint when it encodes, not here.
"""

import csv
import datetime
import io
import logging
import re
import uuid

from sqlalchemy import and_, exists, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.errors import AppError
from app.core.ledger import IST
from app.core.rules import CANCEL_PENALTY_BANDS
from app.models.franchisee import Franchisee
from app.models.ledger import LedgerEntry
from app.models.membership import Membership
from app.models.technician import TechnicianProfile
from app.models.ticket import Ticket
from app.models.user import User

log = logging.getLogger(__name__)

#: The only month a statement may ask about is one that has begun. Matched
#: before any calendar arithmetic, so `2026-13` fails as SHAPE, not as a 404.
_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def parse_month(text: str) -> tuple[int, int]:
    """`2026-10` → (2026, 10). ValueError on anything else.

    The endpoint maps the ValueError to 422 "Month must look like 2026-10";
    keeping the parsing here makes the accepted shape one fact, tested in §6.
    """
    if not _MONTH_RE.match(text or ""):
        raise ValueError(text)
    year, month = text.split("-")
    return int(year), int(month)


def month_bounds(year: int, month: int) -> tuple[datetime.datetime, datetime.datetime]:
    """The half-open UTC range covering an IST calendar month.

    IST, because the monthly penalty cap reckons by IST month (`core.ledger`)
    and one month has to mean the same thirty days on both screens; half-open
    and UTC instants, so the comparison stays on the indexed `created_at`
    rather than wrapping it in a timezone function Postgres cannot use an index
    through — the same reason `ledger.month_start` exists.
    """
    start = datetime.datetime(year, month, 1, tzinfo=IST)
    # Landing on the 1st of the next month by stepping past the longest month
    # and truncating is exact for every month including February — arithmetic
    # `ledger.period_bounds` already relies on.
    end = (start + datetime.timedelta(days=32)).replace(day=1)
    return (
        start.astimezone(datetime.timezone.utc),
        end.astimezone(datetime.timezone.utc),
    )


def month_has_started(year: int, month: int, now: datetime.datetime) -> bool:
    """Is `(year, month)` the current IST month or an earlier one?

    A future month has no rows to print, and a clerk mis-picking October in
    September must be corrected at the form, not handed an empty file they will
    believe. The current month is allowed and reads "to date".
    """
    local = now.astimezone(IST)
    return (year, month) <= (local.year, local.month)


def month_label(year: int, month: int) -> str:
    """`October 2026` — the preamble's month heading.

    English names on purpose: the file is a payroll document with a fixed
    template, and `%B` is locale-dependent — a process whose locale changed
    would quietly start writing `oktober` at the top of statements.
    """
    return (
        ("January", "February", "March", "April", "May", "June", "July",
         "August", "September", "October", "November", "December")[month - 1]
        + f" {year}"
    )


#: Direction and wording per kind. +1 adds to salary, −1 deducts — the same
#: "kind carries the direction, the amount is unsigned" rule the ledger rows
#: follow (`models/ledger.py`). `payout` is deliberately ABSENT: T2 means an
#: employee is never paid per job, and the query excludes the kind anyway.
#:
#: `travel` and the two speed kinds are listed before their writers exist —
#: the template they occupy does not change shape when Tasks 10/11 ship, so
#: the zero lines are the template, not a prophecy.
KIND_LINES: dict[str, tuple[int, str]] = {
    "bonus": (+1, "Reassignment bonus"),
    "travel": (+1, "Travel allowance"),  # Task 10 writes it; listed now
    "speed_reward": (+1, "Speed reward"),  # Task 11
    "reversal": (+1, "Penalty reversed"),
    "penalty": (-1, "Penalty"),
    "speed_penalty": (-1, "Speed penalty"),  # Task 11
}

#: The order the totals block prints in — credit kinds first, then debits, as
#: the approved template lines them up. Fixed so next month's file and last
#: month's put the same kinds on the same lines.
TOTAL_ORDER = ("bonus", "travel", "speed_reward", "reversal", "penalty", "speed_penalty")

#: One row of the statement, exactly what the file needs and nothing more.
#:
#: `reverses_ticket` / `reverses_at` are the reversed PENALTY's ticket and date,
#: set only on a `reversal` row, and read back through the self-join — see
#: `statement_rows`.
class StatementRow:
    __slots__ = (
        "created_at",
        "ticket_code",
        "kind",
        "reason",
        "amount_paise",
        "reverses_ticket",
        "reverses_at",
    )

    def __init__(
        self,
        *,
        created_at: datetime.datetime,
        ticket_code: str,
        kind: str,
        reason: str,
        amount_paise: int,
        reverses_ticket: str | None,
        reverses_at: datetime.datetime | None,
    ) -> None:
        self.created_at = created_at
        self.ticket_code = ticket_code
        self.kind = kind
        self.reason = reason
        self.amount_paise = amount_paise
        self.reverses_ticket = reverses_ticket
        self.reverses_at = reverses_at


def rupees_plain(paise: int) -> str:
    """`40000` → `"400.00"`, `-10000` → `"-100.00"` — no ₹, no grouping.

    The CSV holds a number a spreadsheet will add up; a currency symbol makes
    it text, and thousand separators make it locale-dependent. Two decimals
    because paise is the unit of record and an accountant trusting a rounded
    rupee column is how ledgers drift.
    """
    negative = paise < 0
    rupees, remainder = divmod(abs(paise), 100)
    return f"{'-' if negative else ''}{rupees}.{remainder:02d}"


#: The one character added to a dangerous cell. Excel's apostrophe-prefix
#: convention: the cell then reads as text, and Excel itself hides the mark.
_CSV_QUOTE = "'"

#: A cell beginning with any of these is a formula to a spreadsheet (= + - @)
#: or an instruction to a TSV reader (TAB) or hides a newline (CR) —
#: `+919800000002` opens as a sum of phone numbers in every spreadsheet made
#: this century unless it is guarded.
_DANGEROUS = ("=", "+", "-", "@", "\t", "\r")


def csv_safe(cell: str) -> str:
    """Prefix `'` when the cell would open as a formula. (Owner ruling: apply.)

    Only the FIRST character matters — `"=SUM(A1)"` is a formula, `"paid=done"`
    is text. Applied to every text cell in the file, phone included, because a
    rule that remembers which cells are scary is itself a row waiting to go
    wrong; Excel hides the apostrophe, so the clerk sees the number they expect.
    """
    if cell[:1] in _DANGEROUS:
        return _CSV_QUOTE + cell
    return cell


def _ist_stamp(at: datetime.datetime) -> str:
    """`09 Oct 2026 14:05` — the row's date and time, in IST.

    IST for the same reason the cap and the Earnings screen are: the row
    belongs to the shift it happened in, and a clerk in Delhi must not be able
    to read the row at a different hour than the technician worked it.
    """
    return f"{at.astimezone(IST):%d %b %Y %H:%M}"


def _ist_date(at: datetime.datetime) -> str:
    """`09 Oct 2026` — the day only, for the `Reverses` naming."""
    return f"{at.astimezone(IST):%d %b %Y}"


def _item(kind: str, reason: str) -> str:
    """What the row is called in the file.

    A no-show charge is called what its own screen calls it
    (`earnings._title`, which matches the same constant — the coupling named
    there lives here too), so the statement and the phone agree about a charge
    the technician disputes most; every other kind uses its template label.
    Callers pass only kinds ruled in `KIND_LINES`.
    """
    if kind == "penalty":
        if reason == CANCEL_PENALTY_BANDS[-1]:
            return "No-show penalty"
        return "Penalty"
    return KIND_LINES[kind][1]


def _reverses_text(row: StatementRow) -> str:
    """`<ticket> penalty of <DD Mon YYYY>` — what this reversal undoes.

    "penalty" is not read from the reversed row: `uq_ledger_entries_reverses`
    plus the `reversal_points_back` check make a reversal name a penalty and
    nothing else, so the word is a fact of the schema, not a column to fetch.
    """
    if row.reverses_ticket is None or row.reverses_at is None:
        return ""
    return f"{row.reverses_ticket} penalty of {_ist_date(row.reverses_at)}"


def build_statement_csv(
    *,
    franchisee_name: str,
    franchisee_code: str,
    month_label: str,
    employee_name: str,
    employee_code: str,
    employee_phone: str,
    rows: list[StatementRow],
) -> str:
    """The whole file as text — the endpoint adds the BOM and the filename.

    Every text cell goes through `csv_safe`, including the ones that cannot
    start dangerous today: names are typed by people and phones are copied out
    of the console, and the rule that holds for every cell is the one that does
    not depend on what today's data looks like.

    A month with no rows prints the full skeleton with zero totals — an
    employee who did only salaried work is a real, common answer, and an empty
    file that still LOOKS like the template is what the clerk can file.

    A kind outside `KIND_LINES` (written by a future task before this table was
    taught about it) still prints — with its raw kind as the Item, in Credit,
    under a details note, with its own totals line, excluded from Net, and with
    a log line so the gap is noticed rather than discovered from a payroll
    query two months later.
    """
    lines: list[list[str]] = [
        ["Monthly statement", franchisee_name, month_label],
        ["Employee", employee_name, employee_code, employee_phone],
        [],
        ["Date (IST)", "Ticket", "Item", "Details", "Credit (₹)", "Debit (₹)", "Reverses"],
    ]
    # The details note printed for an unruled kind — a constant, not the row's
    # reason, so the clerk sees at a glance which lines payroll must not fold
    # into the salary sum. See the body loop below.
    UNRECOGNISED_NOTE = "unrecognised item — not in the net"

    # Per-kind sums in PAISE, signed the way the LEDGER thinks (a penalty is
    # money the employee OWES, the same direction `KIND_LINES` encodes). The
    # body rows print the opposite reading — a debit is positive in the debit
    # column — so each sign flip happens exactly once, here, where both
    # readings are written down.
    totals: dict[str, int] = {}
    # Kinds nothing has ruled a direction for: summed unsigned, printed in
    # Credit, kept OUT of Net — see the totals block below.
    unruled: dict[str, int] = {}
    unruled_seen: set[str] = set()
    net = 0
    for row in rows:
        ruled = KIND_LINES.get(row.kind)
        if ruled is None:
            label = row.kind
            details = UNRECOGNISED_NOTE
            credit = row.amount_paise
            debit = 0
            unruled_seen.add(row.kind)
            unruled[row.kind] = unruled.get(row.kind, 0) + row.amount_paise
        else:
            label = _item(row.kind, row.reason)
            details = row.reason
            credit = row.amount_paise if ruled[0] > 0 else 0
            debit = row.amount_paise if ruled[0] < 0 else 0
            totals[row.kind] = totals.get(row.kind, 0) + ruled[0] * row.amount_paise
            net += ruled[0] * row.amount_paise
        lines.append(
            [
                _ist_stamp(row.created_at),
                row.ticket_code,
                label,
                csv_safe(details),
                rupees_plain(credit) if credit else "",
                rupees_plain(debit) if debit else "",
                _reverses_text(row),
            ]
        )

    for kind in unruled_seen:
        log.warning(
            "statement: kind %r is not in KIND_LINES — listed but excluded from "
            "the net for %s / %s",
            kind,
            franchisee_code,
            employee_code,
        )

    lines.append([])
    lines.append(["Totals", "", "", "", "Credit (₹)", "Debit (₹)"])
    for kind in TOTAL_ORDER:
        signed = totals.get(kind, 0)
        lines.append(
            [
                KIND_LINES[kind][1],
                "",
                "",
                "",
                rupees_plain(signed) if signed > 0 else "0.00",
                rupees_plain(-signed) if signed < 0 else "0.00",
            ]
        )
    for kind in sorted(unruled):
        # A credit/debit split for a kind with no ruled direction is not
        # answerable — the row's Details says so, and so the line puts the
        # whole figure in Credit, which is where unruled rows print.
        lines.append([kind, "", "", "", rupees_plain(unruled[kind]), "0.00"])
    lines.append(["Net for the month", "", "", "", rupees_plain(net), ""])

    safe = [ [csv_safe(cell) for cell in line] for line in lines ]
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerows(safe)
    return buf.getvalue()


def statement_filename(
    *, franchisee_code: str, technician_code: str, year: int, month: int
) -> str:
    """`statement-SKY-TCH-4033-2026-10.csv` — who, whom, when, in that order.

    The console never sees `Content-Disposition` (no `expose_headers` in
    `main.py` by choice), so it builds the same name itself; keeping the shape
    in one function stops the two disagreeing.
    """
    return f"statement-{franchisee_code}-{technician_code}-{year:04d}-{month:02d}.csv"


async def statement_rows(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    franchisee_id: uuid.UUID,
    technician_id: uuid.UUID,
    start: datetime.datetime,
    end: datetime.datetime,
) -> list[StatementRow]:
    """The employee stream for one technician at one franchisee, in one month.

    Kind-generic ON PURPOSE (`kind <> 'payout'`, no IN-list): a kind written by
    Task 10 or 11 belongs on the statement the day its writer ships, and the
    only way to miss it is to name kinds here.

    `technician_type = 'employee'` is the stream, stamped at write time (Task
    05 §3.3) — a technician who has since switched to freelancer still has
    their old salary rows, on the statement, where payroll put them.

    The two LEFT JOINs reach through `reverses_id` to the reversed penalty's
    OWN ticket and date, so the reversal line can name the charge it undid.
    `ORDER BY le.created_at, le.id` — chronological, then insertion order, so
    two rows written in the same instant always read the same way. Served by
    Task 01's `ix_ledger_entries_company_franchisee`.
    """
    penalty = aliased(LedgerEntry)
    penalty_ticket = aliased(Ticket)
    rows = await db.execute(
        select(
            LedgerEntry.created_at,
            Ticket.code,
            LedgerEntry.kind,
            LedgerEntry.reason,
            LedgerEntry.amount_paise,
            penalty_ticket.code,
            penalty.created_at,
        )
        .join(
            Ticket,
            and_(
                Ticket.company_id == LedgerEntry.company_id,
                Ticket.id == LedgerEntry.ticket_id,
            ),
        )
        .outerjoin(
            penalty,
            and_(
                penalty.company_id == LedgerEntry.company_id,
                penalty.id == LedgerEntry.reverses_id,
            ),
        )
        .outerjoin(
            penalty_ticket,
            and_(
                penalty_ticket.company_id == penalty.company_id,
                penalty_ticket.id == penalty.ticket_id,
            ),
        )
        .where(
            LedgerEntry.company_id == company_id,
            LedgerEntry.franchisee_id == franchisee_id,
            LedgerEntry.technician_id == technician_id,
            LedgerEntry.technician_type == "employee",
            LedgerEntry.kind != "payout",
            LedgerEntry.created_at >= start,
            LedgerEntry.created_at < end,
        )
        .order_by(LedgerEntry.created_at, LedgerEntry.id)
    )
    return [
        StatementRow(
            created_at=created_at,
            ticket_code=ticket_code,
            kind=kind,
            reason=reason,
            amount_paise=amount_paise,
            reverses_ticket=r_ticket,
            reverses_at=r_at,
        )
        for (
            created_at,
            ticket_code,
            kind,
            reason,
            amount_paise,
            r_ticket,
            r_at,
        ) in rows
    ]


class StatementSheet:
    """Everything the endpoint needs to render one statement, and nothing more.

    The two router doors (`franchise_portal`, `ledger`) are different callers
    with the same answer: same rows, same file, same filename. This is that
    answer — the preamble facts and the month's rows — so both doors stay one
    `load_statement` call away and neither can drift from the other. Slices
    never import each other (rule 4), which is why the loader lives here and
    not in either router.
    """

    __slots__ = (
        "franchisee_name",
        "franchisee_code",
        "employee_name",
        "employee_code",
        "employee_phone",
        "rows",
    )

    def __init__(
        self,
        *,
        franchisee_name: str,
        franchisee_code: str,
        employee_name: str,
        employee_code: str,
        employee_phone: str,
        rows: list[StatementRow],
    ) -> None:
        self.franchisee_name = franchisee_name
        self.franchisee_code = franchisee_code
        self.employee_name = employee_name
        self.employee_code = employee_code
        self.employee_phone = employee_phone
        self.rows = rows


_not_found = AppError(404, "NOT_FOUND", "Statement not found")


def resolve_month(text: str) -> tuple[int, int]:
    """`month=` as a (year, month) pair, with the endpoint's guard rails.

    Shape first — `2026-13` and `October` and a blank all fail as SHAPE (422
    "Month must look like 2026-10"), because a malformed month is a broken
    link, not a date to reason about. Then the calendar: a month that begins
    after the current IST month is refused (422 "Pick a month that has
    started") — there are no rows to print yet, and an empty future file is a
    payroll document that lies. The current month passes: it is "to date".

    Both errors name what to send instead, because the caller is a URL the
    clerk built through a dropdown and a stale bookmark is how it breaks.
    """
    try:
        year, month = parse_month(text)
    except ValueError:
        raise AppError(422, "BAD_MONTH", "Month must look like 2026-10") from None
    if not month_has_started(
        year, month, datetime.datetime.now(datetime.timezone.utc)
    ):
        raise AppError(422, "BAD_MONTH", "Pick a month that has started")
    return year, month


async def load_statement(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    franchisee_id: uuid.UUID,
    technician_id: uuid.UUID,
    year: int,
    month: int,
) -> StatementSheet:
    """Who is found, and what their month says — the wall BOTH doors stand on.

    §4.9's two-clause test, in the spec's order — a technician is an employee
    of franchisee F in that month when EITHER holds:

    * `(profile.franchisee_id == F and profile.technician_type == 'employee')`
      — today's arrangement; or
    * at least one ledger row for F stamped `technician_type='employee'` and
      this technician's id, inside the month. The second clause keeps LAST
      month's statement downloadable after a type change ("T2 turned me off")
      or a carve-out (they left F): the month's rows exist and say so, and the
      current profile proves nothing either way about a closed month.

    Another franchisee's technician, another company's, or an id that was
    never one: the SAME 404, "Statement not found" — never a 403 naming which
    clause failed, for the standing reason a guessed id gets a 404.
    """
    start, end = month_bounds(year, month)
    profile = await db.scalar(
        select(TechnicianProfile).where(
            TechnicianProfile.company_id == company_id,
            TechnicianProfile.id == technician_id,
        )
    )
    of_this_franchisee = (
        profile is not None
        and profile.franchisee_id == franchisee_id
        and profile.technician_type == "employee"
    )
    if not of_this_franchisee:
        earned_here = await db.scalar(
            select(
                exists().where(
                    LedgerEntry.company_id == company_id,
                    LedgerEntry.franchisee_id == franchisee_id,
                    LedgerEntry.technician_id == technician_id,
                    LedgerEntry.technician_type == "employee",
                    LedgerEntry.created_at >= start,
                    LedgerEntry.created_at < end,
                )
            )
        )
        if profile is None or not earned_here:
            raise _not_found

    fr_row = (
        await db.execute(
            select(Franchisee.name, Franchisee.code).where(
                Franchisee.company_id == company_id,
                Franchisee.id == franchisee_id,
            )
        )
    ).one()
    user_row = (
        await db.execute(
            select(User.full_name, User.phone)
            .join(Membership, Membership.user_id == User.id)
            .where(
                Membership.company_id == company_id,
                Membership.id == profile.membership_id,
            )
        )
    ).one()
    franchisee_name, franchisee_code = fr_row
    user_name, user_phone = user_row
    return StatementSheet(
        franchisee_name=franchisee_name,
        franchisee_code=franchisee_code,
        employee_name=(user_name or "").strip(),
        employee_code=profile.code,
        employee_phone=user_phone or "",
        rows=await statement_rows(
            db,
            company_id=company_id,
            franchisee_id=franchisee_id,
            technician_id=technician_id,
            start=start,
            end=end,
        ),
    )


__all__ = [
    "StatementSheet",
    "StatementRow",
    "TOTAL_ORDER",
    "KIND_LINES",
    "build_statement_csv",
    "csv_safe",
    "load_statement",
    "month_bounds",
    "resolve_month",
    "month_has_started",
    "month_label",
    "parse_month",
    "rupees_plain",
    "statement_filename",
    "statement_rows",
]