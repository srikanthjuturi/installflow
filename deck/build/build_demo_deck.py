"""Assemble the end-to-end demo deck.

    deck/.venv/Scripts/python.exe build/build_demo_deck.py

Produces:
    dist/Reliance GreenTech - End to End.pptx

This is the THIRD deck and it is deliberately unlike the other two. The Product
Overview and the Screen Catalogue are screenshot-led — they show the product.
This one explains the mechanism, in drawn shapes and plain sentences, so it can
be presented before anybody has seen a screen, and so it does not depend on the
capture pipeline at all.

Colours and type come from `theme.py`, the same tokens the other decks and the
document use.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from pptx import Presentation  # noqa: E402
from pptx.dml.color import RGBColor  # noqa: E402
from pptx.enum.shapes import MSO_SHAPE  # noqa: E402
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN  # noqa: E402
from pptx.util import Emu, Inches, Pt  # noqa: E402

import theme as T  # noqa: E402

DECK_ROOT = Path(__file__).resolve().parent.parent
DIST = DECK_ROOT / "dist"

# The five parties, in the colours the experience map and the console use for
# them. Keeping one set across every deliverable is what lets somebody who saw
# the map recognise a party here without being told again.
VENDOR = RGBColor(0x1F, 0x6F, 0xEB)
CUSTOMER = RGBColor(0x14, 0x68, 0x3A)
TECH = RGBColor(0xB4, 0x53, 0x09)
COMPANY = RGBColor(0x2C, 0x2F, 0x74)
PLATFORM = RGBColor(0x5A, 0x67, 0x72)
DANGER = RGBColor(0xC8, 0x1E, 0x1E)

FOOTER = "Installation & Demo platform"


# ── Slide furniture ──────────────────────────────────────────────────────────


def new_deck() -> Presentation:
    prs = Presentation()
    prs.slide_width = T.SLIDE_W
    prs.slide_height = T.SLIDE_H
    return prs


def blank(prs: Presentation, dark: bool = False):
    """A slide with a painted ground. Everything else is drawn onto it."""
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, T.SLIDE_W, T.SLIDE_H)
    bg.fill.solid()
    bg.fill.fore_color.rgb = T.INK if dark else T.PAGE
    bg.line.fill.background()
    bg.shadow.inherit = False
    return slide


def text(
    slide,
    left,
    top,
    width,
    height,
    body: str,
    *,
    size=T.SUB_SIZE,
    bold=False,
    colour=None,
    align=PP_ALIGN.LEFT,
    anchor=MSO_ANCHOR.TOP,
    spacing=1.0,
    tracking=False,
):
    box = slide.shapes.add_textbox(left, top, width, height)
    frame = box.text_frame
    frame.word_wrap = True
    frame.vertical_anchor = anchor
    frame.margin_left = frame.margin_right = 0
    frame.margin_top = frame.margin_bottom = 0

    for index, line in enumerate(body.split("\n")):
        para = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
        para.alignment = align
        para.line_spacing = spacing
        run = para.add_run()
        run.text = line
        run.font.size = size
        run.font.bold = bold
        run.font.name = T.FONT
        run.font.color.rgb = colour if colour is not None else T.INK
        if tracking:
            # Uppercase eyebrows need air or they read as a solid block.
            run.font._rPr.set("spc", "140")
    return box


def eyebrow(slide, label: str, colour=None):
    text(
        slide,
        T.MARGIN,
        Inches(0.52),
        Inches(8),
        Inches(0.3),
        label.upper(),
        size=T.EYEBROW_SIZE,
        bold=True,
        colour=colour if colour is not None else T.MUTED,
        tracking=True,
    )


def heading(slide, title: str, *, colour=None, top=Inches(0.92)):
    text(
        slide,
        T.MARGIN,
        top,
        T.SLIDE_W - 2 * T.MARGIN,
        Inches(1.1),
        title,
        size=T.HEADLINE_SIZE,
        bold=True,
        colour=colour if colour is not None else T.INK,
        spacing=1.06,
    )


def footer(slide, note: str = "", *, on_dark=False):
    text(
        slide,
        T.MARGIN,
        T.SLIDE_H - Inches(0.52),
        T.SLIDE_W - 2 * T.MARGIN,
        Inches(0.3),
        note or f"{FOOTER} · {T.today()}",
        size=T.FOOT_SIZE,
        colour=T.ON_INK_MUTED if on_dark else T.MUTED,
    )


def card(slide, left, top, width, height, *, tint=None, fill=None, radius=0.06):
    """A plate. Border and fill are spent by role, not stamped on everything."""
    shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, top, width, height)
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill if fill is not None else T.WHITE
    if tint is not None:
        shape.line.color.rgb = tint
        shape.line.width = Pt(1.5)
    else:
        shape.line.color.rgb = T.BORDER
        shape.line.width = Pt(0.75)
    shape.shadow.inherit = False
    try:
        shape.adjustments[0] = radius
    except (IndexError, KeyError):
        pass
    return shape


def arrow(slide, left, top, width, height, colour=None):
    shape = slide.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, left, top, width, height)
    shape.fill.solid()
    shape.fill.fore_color.rgb = colour if colour is not None else RGBColor(0x9A, 0xA6, 0xB1)
    shape.line.fill.background()
    shape.shadow.inherit = False
    return shape


# ── The slides ───────────────────────────────────────────────────────────────


def slide_title(prs):
    slide = blank(prs, dark=True)
    text(
        slide,
        T.MARGIN,
        Inches(2.15),
        Inches(9.4),
        Inches(0.4),
        FOOTER.upper(),
        size=T.EYEBROW_SIZE,
        bold=True,
        colour=T.ON_INK_MUTED,
        tracking=True,
    )
    text(
        slide,
        T.MARGIN,
        Inches(2.7),
        Inches(10.4),
        Inches(2.2),
        "One job, five parties,\nno step taken on trust",
        size=T.TITLE_SIZE,
        bold=True,
        colour=T.ON_INK,
        spacing=1.04,
    )
    text(
        slide,
        T.MARGIN,
        Inches(4.9),
        Inches(9.2),
        Inches(0.9),
        "From the vendor's ticket to the money reaching the technician's bank.",
        size=Pt(16),
        colour=T.ON_INK_MUTED,
    )
    footer(slide, on_dark=True)


def slide_parties(prs):
    slide = blank(prs)
    eyebrow(slide, "Who is involved")
    heading(slide, "Five parties touch a single job")

    # No hard line breaks: the card is narrow, so a forced break plus the
    # natural wrap gives a ragged two-word line every time.
    people = [
        (VENDOR, "The vendor", "Raises every ticket. Company staff no longer create them."),
        (CUSTOMER, "The customer", "Picks the appointment. Never logs in — taps two links."),
        (TECH, "The technician", "Accepts the job and proves the work on site."),
        (COMPANY, "Your team", "Supervises, steps in, and settles the money."),
        (PLATFORM, "The platform", "Us. Holds the geography master and the credits."),
    ]

    usable = T.SLIDE_W - 2 * T.MARGIN
    gap = Inches(0.24)
    width = Emu(int((usable - gap * (len(people) - 1)) / len(people)))
    top = Inches(2.25)
    height = Inches(2.5)

    for index, (tint, who, what) in enumerate(people):
        left = Emu(int(T.MARGIN + index * (width + gap)))
        card(slide, left, top, width, height, tint=tint)
        # A colour bar rather than a coloured card: the tint identifies the
        # party, it does not need to shout over the words.
        bar = slide.shapes.add_shape(
            MSO_SHAPE.ROUNDED_RECTANGLE, left + Inches(0.3), top + Inches(0.34),
            Inches(0.5), Inches(0.09),
        )
        bar.fill.solid()
        bar.fill.fore_color.rgb = tint
        bar.line.fill.background()
        bar.shadow.inherit = False

        text(slide, left + Inches(0.3), top + Inches(0.62), width - Inches(0.6),
             Inches(0.45), who, size=Pt(17), bold=True, colour=tint)
        text(slide, left + Inches(0.3), top + Inches(1.16), width - Inches(0.6),
             Inches(1.2), what, size=Pt(12.5), colour=T.MUTED, spacing=1.3)

    text(
        slide, T.MARGIN, Inches(5.1), usable, Inches(0.9),
        "A vendor's own staff see only the tickets they raised themselves. "
        "Visibility follows geography, and nobody assigns their own territory — "
        "a senior does it for them.",
        size=Pt(13), colour=T.MUTED, spacing=1.35,
    )
    footer(slide)


def slide_setup(prs):
    """How a company comes to exist — and which steps actually gate which.

    Drawn as four columns rather than one chain, because the superadmin's three
    jobs are independent of each other. Only one of them gates the company: the
    free credits are taken from the platform's own numbers at the moment the
    company is created. The map is not a prerequisite for a company at all — it
    is needed later, to give a manager a territory and to check a ticket's
    pincode at intake.
    """
    slide = blank(prs)
    eyebrow(slide, "Before any job exists")
    heading(slide, "How a company comes to exist")

    usable = T.SLIDE_W - 2 * T.MARGIN
    gap = Inches(0.09)
    arrow_w = Inches(0.35)
    widths = [Inches(2.8), Inches(2.7), Inches(3.0), Inches(2.0)]

    lefts, x = [], T.MARGIN
    for index, width in enumerate(widths):
        lefts.append(Emu(int(x)))
        x += width
        if index < len(widths) - 1:
            x += gap + arrow_w + gap

    top = Inches(2.1)
    label_h = Inches(0.34)

    def column_label(left, width, label, colour):
        text(slide, left, top, width, label_h, label.upper(), size=Pt(10.5),
             bold=True, colour=colour, tracking=True)

    # ── 1. The superadmin's three independent jobs ───────────────────────────
    column_label(lefts[0], widths[0], "The platform", PLATFORM)
    jobs = [
        "Sets the platform's own numbers",
        "Loads the map of India",
        "Creates your company",
    ]
    box_h = Inches(0.68)
    for index, label in enumerate(jobs):
        y = Emu(int(top + label_h + Inches(0.16) + index * (box_h + Inches(0.12))))
        card(slide, lefts[0], y, widths[0], box_h, tint=PLATFORM)
        text(slide, lefts[0] + Inches(0.18), y, widths[0] - Inches(0.36), box_h,
             label, size=Pt(12), bold=True, anchor=MSO_ANCHOR.MIDDLE, spacing=1.15)

    # ── 2. What creating it stamps ───────────────────────────────────────────
    column_label(lefts[1], widths[1], "Stamped once", COMPANY)
    stamp_y = Emu(int(top + label_h + Inches(0.16) + box_h + Inches(0.12)))
    card(slide, lefts[1], stamp_y, widths[1], Inches(1.7), tint=COMPANY)
    text(slide, lefts[1] + Inches(0.2), stamp_y + Inches(0.22), widths[1] - Inches(0.4),
         Inches(0.4), "Your company", size=Pt(14), bold=True, colour=COMPANY)
    text(slide, lefts[1] + Inches(0.2), stamp_y + Inches(0.68), widths[1] - Inches(0.4),
         Inches(0.9),
         "Its permanent code, its own copy of the rules, and its free credits.",
         size=Pt(11), colour=T.MUTED, spacing=1.3)
    arrow(slide, Emu(int(lefts[0] + widths[0] + gap)),
          Emu(int(stamp_y + Inches(0.75))), arrow_w, Inches(0.2), colour=PLATFORM)

    # ── 3. The hand-over, and the company's own build-out ────────────────────
    column_label(lefts[2], widths[2], "Your admin takes over", COMPANY)
    build = [
        "Managers, and their territory",
        "Catalogue, brands and serials",
        "The vendor, and its login",
        "Technicians, added or invited",
    ]
    small_h = Inches(0.56)
    for index, label in enumerate(build):
        y = Emu(int(top + label_h + Inches(0.16) + index * (small_h + Inches(0.10))))
        card(slide, lefts[2], y, widths[2], small_h, tint=COMPANY)
        text(slide, lefts[2] + Inches(0.18), y, widths[2] - Inches(0.36), small_h,
             label, size=Pt(11.5), bold=True, anchor=MSO_ANCHOR.MIDDLE)
    arrow(slide, Emu(int(lefts[1] + widths[1] + gap)),
          Emu(int(stamp_y + Inches(0.75))), arrow_w, Inches(0.2), colour=COMPANY)

    # ── 4. Ready ─────────────────────────────────────────────────────────────
    ready_y = Emu(int(stamp_y + Inches(0.35)))
    card(slide, lefts[3], ready_y, widths[3], Inches(1.0),
         tint=T.SUCCESS, fill=T.SUCCESS, radius=0.16)
    text(slide, lefts[3], ready_y, widths[3], Inches(1.0), "Ready to\ntake work",
         size=Pt(13), bold=True, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE,
         colour=T.WHITE, spacing=1.15)
    arrow(slide, Emu(int(lefts[2] + widths[2] + gap)),
          Emu(int(ready_y + Inches(0.4))), arrow_w, Inches(0.2), colour=T.SUCCESS)

    # The two dependencies that are easy to get backwards. Below the tallest
    # column, which is the four-box build-out.
    note_top = Inches(5.45)
    notes = [
        ("The platform's numbers come first",
         "A company's free credits are taken from them at the moment it is created, "
         "so a later change reaches only the companies created after it."),
        ("The map is not needed to create a company",
         "It is needed to give a manager a territory, and again at intake — a "
         "ticket's pincode is checked against it, unlike the company's own."),
    ]
    note_w = Emu(int((usable - Inches(0.5)) / 2))
    for index, (title, body) in enumerate(notes):
        left = Emu(int(T.MARGIN + index * (note_w + Inches(0.5))))
        bar = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, note_top,
                                     Inches(0.05), Inches(1.1))
        bar.fill.solid()
        bar.fill.fore_color.rgb = T.ACCENT
        bar.line.fill.background()
        bar.shadow.inherit = False
        text(slide, left + Inches(0.26), note_top, note_w - Inches(0.26), Inches(0.3),
             title, size=Pt(12.5), bold=True, colour=T.ACCENT)
        text(slide, left + Inches(0.26), note_top + Inches(0.36), note_w - Inches(0.26),
             Inches(0.8), body, size=Pt(11), colour=T.MUTED, spacing=1.3)

    footer(slide)


def slide_lifecycle(prs):
    slide = blank(prs)
    eyebrow(slide, "The happy path")
    heading(slide, "One job, end to end")

    states = [
        ("Slot\nPending", VENDOR),
        ("New", CUSTOMER),
        ("Assigned", TECH),
        ("In\nProgress", TECH),
        ("Awaiting\nCustomer", TECH),
        ("Closed", CUSTOMER),
        ("Paid", CUSTOMER),
    ]

    usable = T.SLIDE_W - 2 * T.MARGIN
    arrow_w = Inches(0.3)
    gap = Inches(0.1)
    width = Emu(int((usable - (arrow_w + 2 * gap) * (len(states) - 1)) / len(states)))
    top = Inches(2.15)
    height = Inches(1.05)

    for index, (label, tint) in enumerate(states):
        left = Emu(int(T.MARGIN + index * (width + arrow_w + 2 * gap)))
        last = index == len(states) - 1
        card(slide, left, top, width, height,
             tint=tint, fill=T.SUCCESS if last else T.WHITE, radius=0.16)
        text(slide, left, top, width, height, label,
             size=Pt(13), bold=True, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE,
             colour=T.WHITE if last else T.INK, spacing=1.15)
        if not last:
            arrow(slide, Emu(int(left + width + gap)),
                  Emu(int(top + height / 2 - Inches(0.1))), arrow_w, Inches(0.2))

    text(
        slide, T.MARGIN, Inches(3.45), usable, Inches(0.36),
        "Each box is a status the ticket really holds. What moves it on:",
        size=Pt(12.5), colour=T.MUTED,
    )

    steps = [
        ("1", "The vendor raises it", "The serial is checked, credits are charged, and both prices are frozen."),
        ("2", "The customer picks a time", "A WhatsApp link, a two-hour window. No app, no login, no password."),
        ("3", "A technician accepts", "Offered only to those with the skill, the pincode and the spare capacity — masked until accepted. First accept wins."),
        ("4", "Proof on site", "Barcode, serial, installation photos and a geo-tagged live shot. Gallery uploads are never accepted."),
        ("5", "The customer confirms", "The only thing that closes a job. A technician cannot sign off their own work."),
        ("6", "The technician is paid", "They ask for the balance, your national head scans a UPI code, and the technician confirms it arrived."),
    ]

    col_w = Emu(int((usable - Inches(0.5)) / 2))
    for index, (num, title, detail) in enumerate(steps):
        col, row = divmod(index, 3)
        left = Emu(int(T.MARGIN + col * (col_w + Inches(0.5))))
        top_i = Inches(3.95) + row * Inches(0.92)

        disc = slide.shapes.add_shape(MSO_SHAPE.OVAL, left, top_i, Inches(0.3), Inches(0.3))
        disc.fill.solid()
        disc.fill.fore_color.rgb = T.INK
        disc.line.fill.background()
        disc.shadow.inherit = False
        text(slide, left, top_i, Inches(0.3), Inches(0.3), num, size=Pt(11), bold=True,
             align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, colour=T.WHITE)

        text(slide, left + Inches(0.46), top_i - Inches(0.02), col_w - Inches(0.46),
             Inches(0.3), title, size=Pt(13), bold=True)
        text(slide, left + Inches(0.46), top_i + Inches(0.28), col_w - Inches(0.46),
             Inches(0.6), detail, size=Pt(11), colour=T.MUTED, spacing=1.25)

    footer(slide)


def slide_two_rules(prs):
    slide = blank(prs, dark=True)
    eyebrow(slide, "The two rules that matter", colour=T.ON_INK_MUTED)
    heading(slide, "Two people, and only those two,\ncan end a job", colour=T.ON_INK)

    rules = [
        (CUSTOMER, "Only the customer closes it",
         "Not the technician, not your staff, not us. A closed job means the "
         "customer said the work was done — so nothing can manufacture that "
         "sentence on a timer."),
        (TECH, "Only the technician confirms the money",
         "Nothing here can see a bank. The payer says they paid and attaches a "
         "screenshot; the person who receives it is the one who confirms it "
         "arrived."),
    ]

    usable = T.SLIDE_W - 2 * T.MARGIN
    gap = Inches(0.5)
    width = Emu(int((usable - gap) / 2))

    for index, (tint, title, detail) in enumerate(rules):
        left = Emu(int(T.MARGIN + index * (width + gap)))
        top = Inches(2.9)
        bar = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, top,
                                     Inches(0.07), Inches(2.0))
        bar.fill.solid()
        bar.fill.fore_color.rgb = tint
        bar.line.fill.background()
        bar.shadow.inherit = False

        text(slide, left + Inches(0.34), top, width - Inches(0.34), Inches(0.8),
             title, size=Pt(20), bold=True, colour=T.ON_INK, spacing=1.12)
        text(slide, left + Inches(0.34), top + Inches(0.95), width - Inches(0.34),
             Inches(1.4), detail, size=Pt(13), colour=T.ON_INK_MUTED, spacing=1.35)

    footer(slide, on_dark=True)


def slide_branches(prs):
    slide = blank(prs)
    eyebrow(slide, "When it does not go to plan")
    heading(slide, "Every branch stays answerable")

    branches = [
        ("Nobody accepts it", DANGER,
         "The job escalates to a manager, who can assign it by hand, fund a bonus "
         "to re-publish it, or ring the customer and agree a new time."),
        ("The technician cancels", DANGER,
         "A penalty, banded by how late it is and shown before they confirm. "
         "The job goes straight back to the pool."),
        ("Nobody was there", DANGER,
         "The priciest band, because they told nobody. Never charged "
         "automatically — a manager confirms it."),
        ("The customer never replies", DANGER,
         "A manager is alerted. Nothing auto-closes; they close it by hand with "
         "a reason, a justification and an attachment, all kept."),
    ]

    usable = T.SLIDE_W - 2 * T.MARGIN
    gap = Inches(0.24)
    width = Emu(int((usable - gap * 3) / 4))
    top = Inches(2.2)
    height = Inches(2.6)

    for index, (title, tint, detail) in enumerate(branches):
        left = Emu(int(T.MARGIN + index * (width + gap)))
        card(slide, left, top, width, height)
        stripe = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, top,
                                        Inches(0.06), height)
        stripe.fill.solid()
        stripe.fill.fore_color.rgb = tint
        stripe.line.fill.background()
        stripe.shadow.inherit = False

        text(slide, left + Inches(0.32), top + Inches(0.34), width - Inches(0.6),
             Inches(0.7), title, size=Pt(15), bold=True, spacing=1.15)
        text(slide, left + Inches(0.32), top + Inches(1.05), width - Inches(0.6),
             Inches(1.4), detail, size=Pt(11), colour=T.MUTED, spacing=1.28)

    text(
        slide, T.MARGIN, Inches(5.2), usable, Inches(0.75),
        "A penalty is not final either — the area manager responsible for the job "
        "can give it back in full, with a written reason. The money returns; the "
        "cancellation stays on the record.",
        size=Pt(13), colour=T.MUTED, spacing=1.35,
    )
    footer(slide)


def slide_costs(prs):
    slide = blank(prs)
    eyebrow(slide, "What cancelling costs")
    heading(slide, "Banded by how late it is")

    rows = [
        ("More than 4 hours before the slot", "₹300"),
        ("Between 2 and 4 hours before", "₹500"),
        ("Less than 2 hours before", "₹800"),
        ("No-show — they simply did not attend", "₹1,200"),
        ("Capped per technician, per calendar month", "₹5,000"),
    ]

    usable = T.SLIDE_W - 2 * T.MARGIN
    width = Emu(int(usable * 0.62))
    top = Inches(2.3)
    row_h = Inches(0.58)

    for index, (label, amount) in enumerate(rows):
        y = Emu(int(top + index * row_h))
        last = index == len(rows) - 1
        rule = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, T.MARGIN,
                                      Emu(int(y + row_h - Inches(0.01))),
                                      width, Inches(0.01))
        rule.fill.solid()
        rule.fill.fore_color.rgb = T.BORDER
        rule.line.fill.background()
        rule.shadow.inherit = False

        text(slide, T.MARGIN, y, Emu(int(width * 0.7)), row_h, label,
             size=Pt(14), anchor=MSO_ANCHOR.MIDDLE,
             bold=last, colour=T.INK if not last else T.INK)
        text(slide, Emu(int(T.MARGIN + width * 0.7)), y, Emu(int(width * 0.3)), row_h,
             amount, size=Pt(15), bold=True, align=PP_ALIGN.RIGHT,
             anchor=MSO_ANCHOR.MIDDLE, colour=DANGER if not last else T.INK)

    note_left = Emu(int(T.MARGIN + width + Inches(0.6)))
    note_w = Emu(int(usable - width - Inches(0.6)))
    card(slide, note_left, top, note_w, Inches(2.5), tint=T.ACCENT)
    text(slide, note_left + Inches(0.34), top + Inches(0.36), note_w - Inches(0.68),
         Inches(0.5), "Defaults, not constants", size=Pt(15), bold=True, colour=T.ACCENT)
    text(slide, note_left + Inches(0.34), top + Inches(0.95), note_w - Inches(0.68),
         Inches(1.4),
         "Every figure here is a setting you control, and any product category can "
         "override all of them except the monthly cap — which limits a person "
         "across every job they worked on, so it belongs to no one category.",
         size=Pt(12), colour=T.MUTED, spacing=1.32)

    text(
        slide, T.MARGIN, Inches(5.5), width, Inches(0.5),
        "The technician sees the exact figure before they confirm. "
        "Nothing is ever charged that the person did not know about.",
        size=Pt(12.5), colour=T.MUTED,
    )
    footer(slide)


def slide_money(prs):
    slide = blank(prs)
    eyebrow(slide, "The money")
    heading(slide, "Two rails, and they never touch")

    usable = T.SLIDE_W - 2 * T.MARGIN

    rails = [
        ("Your company pays the platform", COMPANY,
         ["Your company", "Recharge by UPI", "We confirm", "Credits"],
         "One credit is one rupee. Every ticket raised spends some, and they are "
         "never refunded — a cancellation included. Only we can confirm a "
         "recharge, and that confirmation is the one thing that adds credits."),
        ("Your company pays the technician", TECH,
         ["Work confirmed", "Payout credited", "Technician redeems", "Their bank"],
         "The ledger holds payouts, penalties, bonuses and reversals. One request "
         "takes the whole balance, capped at ₹1,00,000 because that is UPI's limit "
         "on a single transaction."),
    ]

    for rail_index, (title, tint, chain, detail) in enumerate(rails):
        base = Inches(2.15) + rail_index * Inches(2.35)
        text(slide, T.MARGIN, base, usable, Inches(0.35), title,
             size=Pt(16), bold=True, colour=tint)

        arrow_w = Inches(0.28)
        gap = Inches(0.1)
        chip_w = Emu(int((usable * 0.62 - (arrow_w + 2 * gap) * (len(chain) - 1)) / len(chain)))
        chip_top = Emu(int(base + Inches(0.5)))
        chip_h = Inches(0.62)

        for index, label in enumerate(chain):
            left = Emu(int(T.MARGIN + index * (chip_w + arrow_w + 2 * gap)))
            card(slide, left, chip_top, chip_w, chip_h, tint=tint, radius=0.18)
            text(slide, left + Inches(0.08), chip_top, chip_w - Inches(0.16), chip_h,
                 label, size=Pt(11.5), bold=True, align=PP_ALIGN.CENTER,
                 anchor=MSO_ANCHOR.MIDDLE, spacing=1.1)
            if index < len(chain) - 1:
                arrow(slide, Emu(int(left + chip_w + gap)),
                      Emu(int(chip_top + chip_h / 2 - Inches(0.09))),
                      arrow_w, Inches(0.18), colour=tint)

        text(slide, T.MARGIN, Emu(int(base + Inches(1.3))), Emu(int(usable * 0.62)),
             Inches(0.8), detail, size=Pt(11.5), colour=T.MUTED, spacing=1.3)

    note_left = Emu(int(T.MARGIN + usable * 0.66))
    note_w = Emu(int(usable * 0.34))
    card(slide, note_left, Inches(2.15), note_w, Inches(3.1), fill=T.WHITE, tint=T.ACCENT)
    text(slide, note_left + Inches(0.34), Inches(2.5), note_w - Inches(0.68), Inches(0.6),
         "Neither party sees\nthe other's figure", size=Pt(16), bold=True,
         colour=T.ACCENT, spacing=1.14)
    text(slide, note_left + Inches(0.34), Inches(3.35), note_w - Inches(0.68), Inches(1.7),
         "A ticket stamps two amounts the moment it is raised — what the "
         "technician will earn, and what the vendor is charged — and the server "
         "strips each from the other side's view. Re-pricing your catalogue next "
         "month cannot change what an already-accepted job was worth.",
         size=Pt(12), colour=T.MUTED, spacing=1.32)
    footer(slide)


def slide_closing(prs):
    slide = blank(prs, dark=True)
    eyebrow(slide, "In short", colour=T.ON_INK_MUTED)
    heading(slide, "Every step leaves a record", colour=T.ON_INK)

    lines = [
        "The brand on every screen is yours, not ours.",
        "One company's data is never reachable from another's.",
        "A ticket's history lives in its events, not its status column.",
    ]
    for index, line in enumerate(lines):
        top = Inches(2.9) + index * Inches(0.82)
        disc = slide.shapes.add_shape(MSO_SHAPE.OVAL, T.MARGIN, top, Inches(0.42), Inches(0.42))
        disc.fill.solid()
        disc.fill.fore_color.rgb = RGBColor(0x2B, 0x37, 0x42)
        disc.line.fill.background()
        disc.shadow.inherit = False
        text(slide, T.MARGIN, top, Inches(0.42), Inches(0.42), str(index + 1),
             size=Pt(13), bold=True, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE,
             colour=T.ON_INK)
        text(slide, T.MARGIN + Inches(0.72), top, Inches(10.5), Inches(0.5), line,
             size=Pt(17), colour=T.ON_INK, anchor=MSO_ANCHOR.MIDDLE)

    footer(slide, on_dark=True)


def main() -> int:
    prs = new_deck()
    for build in (
        slide_title,
        slide_parties,
        slide_setup,
        slide_lifecycle,
        slide_two_rules,
        slide_branches,
        slide_costs,
        slide_money,
        slide_closing,
    ):
        build(prs)

    DIST.mkdir(exist_ok=True)
    path = DIST / "Reliance GreenTech - End to End.pptx"
    prs.save(path)
    print(f"  {path.name}: {len(prs.slides._sldIdLst)} slides")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
