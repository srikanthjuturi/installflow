"""`app.core.account_statements` -- running balance and the CSV."""

import datetime

from app.core import account_statements as acct

T = datetime.datetime(2026, 10, 1, 12, tzinfo=datetime.timezone.utc)


def line(n, effect, amount, doc="sales_invoice", desc="x"):
    return acct.Line(n, doc, T, desc, effect, amount)


def test_debit_raises_and_credit_reduces_the_balance():
    st = acct.build(0, [line("A", "debit", 1000), line("B", "credit", 400), line("C", "debit", 50)])
    assert [l.balance_paise for l in st.lines] == [1000, 600, 650]
    assert (st.total_debit_paise, st.total_credit_paise) == (1050, 400)
    assert st.closing_paise == 650


def test_opening_balance_carries_and_empty_period_closes_at_opening():
    assert acct.build(5000, []).closing_paise == 5000
    st = acct.build(5000, [line("A", "credit", 5000)])
    assert st.closing_paise == 0


def test_balance_can_go_negative_when_the_company_owes():
    assert acct.build(0, [line("A", "credit", 700)]).closing_paise == -700
    assert acct.balance_words(-700) == "is owed by the company"
    assert acct.balance_words(0) == "settled"


def test_csv_neutralises_formulas_and_prints_totals():
    st = acct.build(0, [line("=CMD", "debit", 12345, desc="@evil")])
    text = acct.build_csv(
        company_name="Acme",
        party_kind="vendor",
        party_label="+Vendor",
        start=datetime.date(2026, 10, 1),
        end=datetime.date(2026, 10, 31),
        statement=st,
    )
    assert "'=CMD" in text and "'@evil" in text and "'+Vendor" in text
    assert "123.45" in text
    assert "Closing balance" in text
