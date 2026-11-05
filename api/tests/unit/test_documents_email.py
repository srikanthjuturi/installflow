"""The documents email: the template fills, and nothing user-supplied is markup."""

from app.emails.documents import DocumentLine, _row
from app.emails.render import Raw, render


def test_row_escapes_every_dynamic_piece():
    row = _row(DocumentLine("RGT-INV-0001", "sales_invoice", "<script>x</script>", 'a"b', 123450))
    assert "<script>" not in row
    assert "&lt;script&gt;" in row
    assert "₹1,234.50" in row


def test_raw_is_the_only_way_to_skip_escaping():
    html = render(
        "documents_issued",
        subject="s",
        preheader="p",
        company="A & B",
        heading="h",
        greeting="g",
        intro="i",
        rows=Raw("<tr><td>ROW</td></tr>"),
        footer="f",
        year=2026,
    )
    assert "<tr><td>ROW</td></tr>" in html
    assert "A &amp; B" in html
