"""Task 06 §6 cases 5–17 — the monthly statement's pure parts.

Everything here answers "what does the FILE look like" without a database:
month parsing and bounds, the rupee cell formatting, the formula-injection
guard, the CSV body from a handful of `StatementRow`s, and the filename. The
SQL half of `statements.py` is covered by §7's acceptance criteria on the
seeded company, not by these.
"""

import datetime

import pytest

from app.core.rules import CANCEL_PENALTY_BANDS
from app.core.statements import (
    KIND_LINES,
    TOTAL_ORDER,
    StatementRow,
    build_statement_csv,
    csv_safe,
    month_bounds,
    month_has_started,
    parse_month,
    rupees_plain,
    statement_filename,
)
from app.models.ledger import LEDGER_KINDS

IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
UTC = datetime.timezone.utc


def _row(
    *,
    when: datetime.datetime,
    kind: str,
    paise: int,
    code: str = "SKY-INST-0412",
    reason: str = "—",
    reverses_ticket: str | None = None,
    reverses_at: datetime.datetime | None = None,
) -> StatementRow:
    return StatementRow(
        created_at=when,
        ticket_code=code,
        kind=kind,
        reason=reason,
        amount_paise=paise,
        reverses_ticket=reverses_ticket,
        reverses_at=reverses_at,
    )


# 5. `month=` is a shape before it is a date: two digits, a hyphen, two digits
#    whose first is 0 or 1 — and nothing wider. The endpoint turns the
#    ValueError into 422.
@pytest.mark.parametrize(
    "text",
    ["2026-13", "2026-1", "26-10", "", "2026-10-01", "October"],
)
def test_case_5_parse_month_rejects(text: str) -> None:
    with pytest.raises(ValueError):
        parse_month(text)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("2026-10", (2026, 10)),
        ("2024-01", (2024, 1)),
        ("2025-12", (2025, 12)),
    ],
)
def test_case_5_parse_month_accepts(text: str, expected: tuple[int, int]) -> None:
    assert parse_month(text) == expected


# 6. The IST month as a half-open UTC range — the arithmetic `month_start`
#    already trusts, exercised over year and leap edges.
def test_case_6_month_bounds() -> None:
    start, end = month_bounds(2026, 10)
    assert start == datetime.datetime(2026, 9, 30, 18, 30, tzinfo=UTC)
    assert end == datetime.datetime(2026, 10, 31, 18, 30, tzinfo=UTC)

    d_start, d_end = month_bounds(2026, 12)
    # December's upper bound is the 1st of January IST, read from UTC.
    assert d_end == datetime.datetime(2026, 12, 31, 18, 30, tzinfo=UTC)

    feb_start, feb_end = month_bounds(2028, 2)
    # Leap February: the 29th is real, and the bound is the 1st of March IST.
    assert feb_end == datetime.datetime(2028, 2, 29, 18, 30, tzinfo=UTC)


# 7. Half-open: the last IST instant of the month is IN it, the first instant
#    of the next is not.
def test_case_7_half_open() -> None:
    _, end = month_bounds(2026, 10)
    assert datetime.datetime(2026, 10, 31, 23, 59, tzinfo=IST) < end
    assert not (datetime.datetime(2026, 11, 1, 0, 0, tzinfo=IST) < end)


# 8. "Has started" reckons where the product counts a month — IST.
def test_case_8_month_has_started() -> None:
    mid_october = datetime.datetime(2026, 10, 15, 6, 0, tzinfo=UTC)
    assert month_has_started(2026, 10, mid_october)
    assert month_has_started(2026, 9, mid_october)  # an earlier one, for history
    assert not month_has_started(2026, 11, mid_october)
    not_yet = month_has_started(2026, 12, mid_october)
    assert not_yet is False

    # 31 Oct 20:00 UTC is 1 Nov in IST — November HAS started, and the answer
    # must not depend on which office is still awake.
    assert month_has_started(
        2026, 11, datetime.datetime(2026, 10, 31, 20, 0, tzinfo=UTC)
    )


# 9. Paise as the payroll column sees it: two decimals, sign only when there.
@pytest.mark.parametrize(
    ("paise", "expected"),
    [((0), "0.00"), ((40050), "400.50"), ((-10000), "-100.00"), ((1), "0.01")],
)
def test_case_9_rupees_plain(paise: int, expected: str) -> None:
    assert rupees_plain(paise) == expected


# 10. The formula guard: a cell that would open as a formula gets the quote
#     Excel hides; a name does not.
def test_case_10_csv_safe() -> None:
    assert csv_safe("=SUM(A1)") == "'=SUM(A1)"
    assert csv_safe("+919800000002") == "'+919800000002"
    assert csv_safe("-x") == "'-x"
    assert csv_safe("@x") == "'@x"
    assert csv_safe("Meena") == "Meena"
    assert csv_safe("") == ""


# 11. The coverage gate: every kind the ledger can carry except `payout` (T2 —
#     an employee is never paid per job) must have a statement line, and the
#     totals order must be exactly the ruled kinds. When Task 10/11 add a kind
#     without teaching this file, the build fails HERE instead of payroll
#     discovering the missing column.
def test_case_11_coverage_gate() -> None:
    assert set(LEDGER_KINDS) - {"payout"} <= set(KIND_LINES)
    assert set(TOTAL_ORDER) == set(KIND_LINES)


def _example_rows() -> list[StatementRow]:
    """The §1 worked example: a penalty, a bonus, and its reversal."""
    return [
        _row(
            when=datetime.datetime(2026, 10, 9, 14, 5, tzinfo=IST),
            kind="penalty",
            paise=50000,
            code="SKY-INST-0412",
            reason="Cancel 2–4h before slot",
        ),
        _row(
            when=datetime.datetime(2026, 10, 12, 18, 40, tzinfo=IST),
            kind="bonus",
            paise=40000,
            code="SKY-INST-0419",
            reason="Escalation pickup",
        ),
        _row(
            when=datetime.datetime(2026, 10, 28, 11, 2, tzinfo=IST),
            kind="reversal",
            paise=50000,
            code="SKY-INST-0412",
            reason="Customer moved the visit",
            reverses_ticket="SKY-INST-0412",
            reverses_at=datetime.datetime(2026, 10, 9, 14, 5, tzinfo=IST),
        ),
    ]


def _built(rows: list[StatementRow]) -> list[str]:
    body = build_statement_csv(
        franchisee_name="SkyFix Services",
        franchisee_code="SKY",
        month_label="October 2026",
        employee_name="Meena R",
        employee_code="TCH-4033",
        employee_phone="+919800000002",
        rows=rows,
    )
    return body.split("\r\n")


# 12. The worked example renders as the template — preamble, exact column
#     header, the Reverses naming, zero lines for kinds that have not shipped,
#     and the net the example says it must.
def test_case_12_example_layout() -> None:
    lines = _built(_example_rows())
    assert lines[0] == "Monthly statement,SkyFix Services,October 2026"
    assert lines[1] == "Employee,Meena R,TCH-4033,'+919800000002"
    assert lines[2] == ""
    assert lines[3] == (
        "Date (IST),Ticket,Item,Details,Credit (₹),Debit (₹),Reverses"
    )
    reversal_line = next(l for l in lines if l.startswith("28 Oct 2026"))
    assert reversal_line.endswith("SKY-INST-0412 penalty of 09 Oct 2026")
    # Kinds that have not shipped yet are STILL in the clerk's template.
    assert "Travel allowance,,,,0.00,0.00" in lines
    assert "Speed reward,,,,0.00,0.00" in lines
    assert "Speed penalty,,,,0.00,0.00" in lines
    net = next(l for l in lines if l.startswith("Net for the month"))
    assert net == "Net for the month,,,,400.00,"


# 13. A month with no rows is still the template: header, all-zero totals for
#     every ruled kind, net 0.00 — an employee who did only salaried work.
def test_case_13_empty_month() -> None:
    lines = _built([])
    assert lines[3].startswith("Date (IST),")
    for kind in TOTAL_ORDER:
        zero_line = f"{KIND_LINES[kind][1]},,,,0.00,0.00"
        assert zero_line in lines, zero_line
    assert "Net for the month,,,,0.00," in lines


# 14. A kind nothing has ruled on (a future writer before §4.9's table) is
#     LISTED — hidden money is worse than unsummed money — with the details
#     note, in Credit, its own totals line, and OUT of the net.
def test_case_14_unrecognised_kind() -> None:
    body = build_statement_csv(
        franchisee_name="SkyFix Services",
        franchisee_code="SKY",
        month_label="October 2026",
        employee_name="Meena R",
        employee_code="TCH-4033",
        employee_phone="919800000002",
        rows=[_row(when=datetime.datetime(2026, 10, 5, 9, 0, tzinfo=IST),
                   kind="mystery", paise=12300)],
    )
    lines = body.split("\r\n")
    item = next(l for l in lines if "mystery" in l and "not in the net" in l)
    assert ",123.00," in item  # amount under Credit
    assert "mystery,,,,123.00,0.00" in lines  # its own totals line
    net = next(l for l in lines if l.startswith("Net for the month"))
    assert net == "Net for the month,,,,0.00,"  # excluded from the net


# 15. A no-show charge reads as its own screen reads it (`earnings._title`,
#     the same constant) — the coupling named there, tested here.
def test_case_15_no_show_item() -> None:
    body = build_statement_csv(
        franchisee_name="SkyFix Services",
        franchisee_code="SKY",
        month_label="October 2026",
        employee_name="Meena R",
        employee_code="TCH-4033",
        employee_phone="919800000002",
        rows=[_row(when=datetime.datetime(2026, 10, 5, 9, 0, tzinfo=IST),
                   kind="penalty", paise=80000,
                   reason=CANCEL_PENALTY_BANDS[-1])],
    )
    assert ",No-show penalty," in body


# 16. Dates render in IST, not in the writer's clock.
def test_case_16_dates_in_ist() -> None:
    body = build_statement_csv(
        franchisee_name="SkyFix Services",
        franchisee_code="SKY",
        month_label="October 2026",
        employee_name="Meena R",
        employee_code="TCH-4033",
        employee_phone="919800000002",
        rows=[_row(when=datetime.datetime(2026, 10, 9, 8, 35, tzinfo=UTC),
                   kind="bonus", paise=40000)],
    )
    assert "09 Oct 2026 14:05" in body


# 17. The filename the console has to reconstruct without seeing the headers.
def test_case_17_statement_filename() -> None:
    assert (
        statement_filename(franchisee_code="SKY", technician_code="TCH-4033",
                           year=2026, month=10)
        == "statement-SKY-TCH-4033-2026-10.csv"
    )
    # Zero-padded, so a directory of statements sorts by month, not by string.
    assert (
        statement_filename(franchisee_code="SKY", technician_code="TCH-1",
                           year=2027, month=1)
        == "statement-SKY-TCH-1-2027-01.csv"
    )