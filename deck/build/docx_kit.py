"""Small helpers for building the client document.

Word's own defaults produce something that looks like a memo. These give the
document one consistent voice: a sans face throughout, the product's accent
colour on headings, screenshots sized to the text column, and captions that read
as captions.
"""

from __future__ import annotations

import datetime
from pathlib import Path

from PIL import Image
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

# ── Palette, the same one the decks use ──────────────────────────────────────
INK = RGBColor(0x14, 0x1B, 0x22)
ACCENT = RGBColor(0x1F, 0x6F, 0xEB)
MUTED = RGBColor(0x5A, 0x67, 0x72)
RULE = RGBColor(0xD5, 0xDD, 0xE4)

BODY_FONT = "Segoe UI"   # present on every Windows machine; no substitution surprise
TEXT_WIDTH_CM = 16.0     # A4 (21 cm) less 2.5 cm margins each side


def configure(document):
    """A4, sane margins, and a body style that is not Word's default."""
    for section in document.sections:
        section.page_width = Cm(21.0)
        section.page_height = Cm(29.7)
        section.left_margin = section.right_margin = Cm(2.5)
        section.top_margin = Cm(2.2)
        section.bottom_margin = Cm(2.2)

    normal = document.styles["Normal"]
    normal.font.name = BODY_FONT
    normal.font.size = Pt(10.5)
    normal.font.color.rgb = INK
    normal.paragraph_format.space_after = Pt(8)
    normal.paragraph_format.line_spacing = 1.28
    return document


def _run(paragraph, text, *, size, bold=False, italic=False, colour=INK,
         font=BODY_FONT, caps=False):
    run = paragraph.add_run(text)
    run.font.name = font
    run.font.size = size
    run.bold = bold
    run.italic = italic
    run.font.color.rgb = colour
    if caps:
        run.font.all_caps = True
    return run


def today() -> str:
    """`7 September 2026`, stamped at build time.

    The screenshots are a moment in time and the product ships several times a
    day, so an undated document quietly stops saying how current it is.

    Written by hand rather than with `%-d`, which the C runtime on Windows does
    not support and which would print `07`.
    """
    now = datetime.date.today()
    return f"{now.day} {now:%B %Y}"


def title_block(document, *, eyebrow, title, subtitle, mark: Path | None = None,
                date: str | None = None):
    if mark and mark.exists():
        para = document.add_paragraph()
        para.paragraph_format.space_after = Pt(18)
        para.add_run().add_picture(str(mark), height=Cm(1.5))

    para = document.add_paragraph()
    para.paragraph_format.space_after = Pt(4)
    _run(para, eyebrow, size=Pt(9.5), bold=True, colour=ACCENT, caps=True)

    para = document.add_paragraph()
    para.paragraph_format.space_after = Pt(10)
    _run(para, title, size=Pt(30), bold=True)

    para = document.add_paragraph()
    para.paragraph_format.space_after = Pt(6)
    _run(para, subtitle, size=Pt(13), colour=MUTED)

    if date:
        para = document.add_paragraph()
        para.paragraph_format.space_before = Pt(12)
        para.paragraph_format.space_after = Pt(6)
        _run(para, date, size=Pt(10), colour=MUTED)


def h1(document, text, *, page_break=True):
    if page_break:
        document.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
    para = document.add_paragraph()
    para.paragraph_format.space_before = Pt(2)
    para.paragraph_format.space_after = Pt(10)
    _run(para, text, size=Pt(20), bold=True)
    _rule(document)
    return para


def h2(document, text):
    para = document.add_paragraph()
    para.paragraph_format.space_before = Pt(14)
    para.paragraph_format.space_after = Pt(5)
    _run(para, text, size=Pt(13.5), bold=True)
    return para


def h3(document, text):
    para = document.add_paragraph()
    para.paragraph_format.space_before = Pt(10)
    para.paragraph_format.space_after = Pt(3)
    _run(para, text, size=Pt(11), bold=True, colour=ACCENT)
    return para


def p(document, text, *, size=Pt(10.5), colour=INK, italic=False, space_after=8):
    """A paragraph. `**bold**` spans are honoured, because a document that can
    never emphasise a term reads flat over thirty pages."""
    para = document.add_paragraph()
    para.paragraph_format.space_after = Pt(space_after)
    for index, chunk in enumerate(text.split("**")):
        if chunk:
            _run(para, chunk, size=size, bold=index % 2 == 1, italic=italic, colour=colour)
    return para


def bullet(document, text):
    para = document.add_paragraph(style="List Bullet")
    para.paragraph_format.space_after = Pt(3)
    para.paragraph_format.left_indent = Cm(0.7)
    for index, chunk in enumerate(text.split("**")):
        if chunk:
            _run(para, chunk, size=Pt(10.5), bold=index % 2 == 1)
    return para


def callout(document, text):
    """A boxed aside for the thing a reader would otherwise ask about."""
    table = document.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    cell = table.rows[0].cells[0]
    cell.width = Cm(TEXT_WIDTH_CM)
    _shade(cell, "F2F6FB")
    para = cell.paragraphs[0]
    para.paragraph_format.space_before = Pt(6)
    para.paragraph_format.space_after = Pt(6)
    for index, chunk in enumerate(text.split("**")):
        if chunk:
            _run(para, chunk, size=Pt(10), bold=index % 2 == 1, colour=INK)
    document.add_paragraph().paragraph_format.space_after = Pt(2)
    return table


def table(document, headers, rows, *, widths=None):
    grid = document.add_table(rows=1, cols=len(headers))
    grid.style = "Table Grid"
    grid.alignment = WD_TABLE_ALIGNMENT.CENTER

    for index, heading in enumerate(headers):
        cell = grid.rows[0].cells[index]
        _shade(cell, "141B22")
        para = cell.paragraphs[0]
        para.paragraph_format.space_after = Pt(2)
        _run(para, heading, size=Pt(9.5), bold=True, colour=RGBColor(0xFF, 0xFF, 0xFF))

    for row in rows:
        cells = grid.add_row().cells
        for index, value in enumerate(row):
            para = cells[index].paragraphs[0]
            para.paragraph_format.space_after = Pt(2)
            for part, chunk in enumerate(str(value).split("**")):
                if chunk:
                    _run(para, chunk, size=Pt(9.5), bold=part % 2 == 1)

    if widths:
        for row in grid.rows:
            for index, width in enumerate(widths):
                row.cells[index].width = Cm(width)

    document.add_paragraph().paragraph_format.space_after = Pt(2)
    return grid


def figure(document, path: Path, caption: str, *, width_cm=TEXT_WIDTH_CM):
    """One screenshot, sized to the column and captioned beneath."""
    if not path.exists():
        return None

    with Image.open(path) as image:
        source_w, source_h = image.size

    # A tall phone shot at full column width would run off the page, so cap the
    # height instead and let the width follow.
    max_height_cm = 12.5
    height_cm = width_cm * source_h / source_w
    if height_cm > max_height_cm:
        width_cm = max_height_cm * source_w / source_h

    para = document.add_paragraph()
    para.alignment = WD_ALIGN_PARAGRAPH.CENTER
    para.paragraph_format.space_before = Pt(6)
    para.paragraph_format.space_after = Pt(3)
    para.add_run().add_picture(str(path), width=Cm(width_cm))

    _caption(document, caption)
    return para


def figure_row(document, paths, captions, *, height_cm=9.0):
    """Two or three phone screenshots side by side."""
    paths = [path for path in paths if path.exists()]
    if not paths:
        return None

    grid = document.add_table(rows=1, cols=len(paths))
    grid.alignment = WD_TABLE_ALIGNMENT.CENTER

    for index, path in enumerate(paths):
        cell = grid.rows[0].cells[index]
        cell.width = Cm(TEXT_WIDTH_CM / len(paths))
        para = cell.paragraphs[0]
        para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        para.paragraph_format.space_after = Pt(2)
        para.add_run().add_picture(str(path), height=Cm(height_cm))

        if index < len(captions) and captions[index]:
            label = cell.add_paragraph()
            label.alignment = WD_ALIGN_PARAGRAPH.CENTER
            label.paragraph_format.space_after = Pt(2)
            _run(label, captions[index], size=Pt(8.5), colour=MUTED)

    document.add_paragraph().paragraph_format.space_after = Pt(4)
    return grid


def _caption(document, text):
    para = document.add_paragraph()
    para.alignment = WD_ALIGN_PARAGRAPH.CENTER
    para.paragraph_format.space_after = Pt(12)
    _run(para, text, size=Pt(8.5), italic=True, colour=MUTED)
    return para


def _rule(document):
    """A hairline under a chapter heading."""
    para = document.add_paragraph()
    para.paragraph_format.space_after = Pt(12)
    borders = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "6")
    bottom.set(qn("w:color"), "D5DDE4")
    borders.append(bottom)
    para._p.get_or_add_pPr().append(borders)
    return para


def _shade(cell, hex_colour):
    shading = OxmlElement("w:shd")
    shading.set(qn("w:val"), "clear")
    shading.set(qn("w:fill"), hex_colour)
    cell._tc.get_or_add_tcPr().append(shading)


def page_break(document):
    document.add_paragraph().add_run().add_break(WD_BREAK.PAGE)


def footer_text(document, text):
    for section in document.sections:
        para = section.footer.paragraphs[0]
        para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        para.text = ""
        _run(para, text, size=Pt(8), colour=MUTED)
