"""Slide constructors.

Six layouts, and the discipline that makes the deck work: a screenshot slide
carries a 3-6 word headline and at most one supporting line. No bullets. The
screens carry the story and the presenter does the talking — which is what was
asked for, and also what stops a deck of real product shots turning into a wall
of text nobody reads.
"""

from PIL import Image
from pptx.util import Emu, Inches, Pt
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

import theme as T


def _blank(prs):
    return prs.slides.add_slide(prs.slide_layouts[6])


def _fill(slide, colour):
    bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, T.SLIDE_W, T.SLIDE_H)
    bg.fill.solid()
    bg.fill.fore_color.rgb = colour
    bg.line.fill.background()
    bg.shadow.inherit = False
    # Backgrounds are drawn first; nothing should ever sit behind one.
    slide.shapes._spTree.remove(bg._element)
    slide.shapes._spTree.insert(2, bg._element)
    return bg


def _text(slide, left, top, width, height, runs, *, align=PP_ALIGN.LEFT,
          anchor=MSO_ANCHOR.TOP):
    box = slide.shapes.add_textbox(left, top, width, height)
    frame = box.text_frame
    frame.word_wrap = True
    frame.vertical_anchor = anchor
    frame.margin_left = frame.margin_right = 0
    frame.margin_top = frame.margin_bottom = 0

    for index, (content, size, colour, bold, space_before) in enumerate(runs):
        para = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
        para.alignment = align
        if space_before:
            para.space_before = space_before
        run = para.add_run()
        run.text = content
        run.font.size = size
        run.font.bold = bold
        run.font.color.rgb = colour
        run.font.name = T.FONT
    return box


def _picture(slide, path, box_left, box_top, box_w, box_h, *, shadow=True,
             device=False):
    with Image.open(path) as image:
        source_w, source_h = image.size

    # A device shell needs room for its own bezel, so shrink the picture rather
    # than let the shell overflow the box it was given.
    inset = 1.06 if device else 1.0
    width, height = T.fit(int(box_w / inset), int(box_h / inset), source_w, source_h)
    left = T.centre(box_left, box_w, width)
    top = T.centre(box_top, box_h, height)

    if device:
        _device(slide, left, top, width, height)

    if shadow:
        # A hairline plate behind the shot. Console screenshots are white-on-white
        # against the page colour and would otherwise float with no edge.
        plate = slide.shapes.add_shape(
            MSO_SHAPE.ROUNDED_RECTANGLE, Emu(left - 6350), Emu(top - 6350),
            Emu(width + 12700), Emu(height + 12700),
        )
        plate.fill.solid()
        plate.fill.fore_color.rgb = T.WHITE
        plate.line.color.rgb = T.BORDER
        plate.line.width = Pt(0.75)
        plate.adjustments[0] = 0.02
        plate.shadow.inherit = False

    picture = slide.shapes.add_picture(path, left, top, width, height)
    # Office's default picture style carries a soft drop shadow. On a phone shot
    # with transparent rounded corners that reads as a grey halo boxing the
    # device in — so opt out rather than inherit it.
    picture.shadow.inherit = False
    return picture


# ── The six layouts ──────────────────────────────────────────────────────────

def title_slide(prs, *, title, subtitle, footer, mark=None):
    slide = _blank(prs)
    _fill(slide, T.INK)

    if mark and mark.exists():
        slide.shapes.add_picture(str(mark), T.MARGIN, Inches(0.72),
                                 height=Inches(0.78))

    _text(slide, T.MARGIN, Inches(2.45), Inches(9.6), Inches(3.0), [
        (title, T.TITLE_SIZE, T.WHITE, True, None),
        (subtitle, Pt(17), T.ON_INK_MUTED, False, Pt(14)),
    ])

    _text(slide, T.MARGIN, Inches(6.45), Inches(11.0), Inches(0.5), [
        (footer, T.FOOT_SIZE, T.ON_INK_MUTED, False, None),
    ])

    accent = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, T.MARGIN, Inches(2.16),
                                    Inches(1.5), Inches(0.055))
    accent.fill.solid()
    accent.fill.fore_color.rgb = T.ACCENT
    accent.line.fill.background()
    accent.shadow.inherit = False
    return slide


def section_slide(prs, *, eyebrow, title):
    slide = _blank(prs)
    _fill(slide, T.INK)

    _text(slide, T.MARGIN, Inches(3.0), Inches(10.5), Inches(1.9), [
        (eyebrow.upper(), T.EYEBROW_SIZE, T.ACCENT, True, None),
        (title, T.SECTION_SIZE, T.WHITE, True, Pt(10)),
    ])
    return slide


def console_slide(prs, *, title, sub, image):
    """A landscape screenshot, headline above it."""
    slide = _blank(prs)
    _fill(slide, T.PAGE)

    _text(slide, T.MARGIN, Inches(0.46), Inches(11.6), Inches(1.0), [
        (title, T.HEADLINE_SIZE, T.INK, True, None),
    ] + ([(sub, T.SUB_SIZE, T.MUTED, False, Pt(6))] if sub else []))

    top = Inches(1.72) if sub else Inches(1.5)
    _picture(slide, str(image), T.MARGIN, top,
             Emu(T.SLIDE_W - 2 * T.MARGIN), Emu(T.SLIDE_H - top - Inches(0.5)))
    return slide


def _device(slide, left, top, width, height):
    """A phone shell behind a raw screenshot.

    Prototype shots arrive with the device already drawn around them; the real
    app, screenshotted at 392x812, arrives as a bare rectangle. Drawing the shell
    here means the two sit side by side in one deck without the real screens
    looking like an afterthought — and the proportions match the prototype's
    (11px bezel, 44px corner on a 392pt-wide frame).
    """
    bezel = Emu(int(width * (11 / 392)))
    shell = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE,
        Emu(left - bezel), Emu(top - bezel),
        Emu(width + 2 * bezel), Emu(height + 2 * bezel),
    )
    shell.fill.solid()
    shell.fill.fore_color.rgb = T.INK
    shell.line.fill.background()
    shell.shadow.inherit = False
    shell.adjustments[0] = 0.055
    return shell


def phone_slide(prs, *, title, sub, image, framed=True):
    """One phone, set beside its headline rather than under it — a 392x812 shot
    leaves a lot of empty slide otherwise."""
    slide = _blank(prs)
    _fill(slide, T.PAGE)

    _text(slide, Inches(1.0), Inches(2.55), Inches(6.0), Inches(2.4), [
        (title, T.HEADLINE_SIZE, T.INK, True, None),
    ] + ([(sub, T.SUB_SIZE, T.MUTED, False, Pt(10))] if sub else []))

    _picture(slide, str(image), Inches(8.0), Inches(0.5),
             Inches(4.6), Inches(6.5), shadow=False, device=not framed)
    return slide


def phone_grid_slide(prs, *, title, sub, images, captions, framed=True):
    """Two to four phones in a row — how the four proof artifacts read as one
    step rather than four slides."""
    slide = _blank(prs)
    _fill(slide, T.PAGE)

    _text(slide, T.MARGIN, Inches(0.46), Inches(11.6), Inches(1.0), [
        (title, T.HEADLINE_SIZE, T.INK, True, None),
    ] + ([(sub, T.SUB_SIZE, T.MUTED, False, Pt(6))] if sub else []))

    count = len(images)
    band_top = Inches(1.55)
    band_h = Inches(5.05)
    cell_w = Emu(int((T.SLIDE_W - 2 * T.MARGIN) / count))

    for index, path in enumerate(images):
        left = Emu(int(T.MARGIN + index * cell_w))
        _picture(slide, str(path), left, band_top, cell_w, band_h, shadow=False,
                 device=not framed)
        if index < len(captions) and captions[index]:
            _text(slide, left, Inches(6.76), cell_w, Inches(0.45),
                  [(captions[index], Pt(12), T.MUTED, False, None)],
                  align=PP_ALIGN.CENTER)
    return slide


def split_slide(prs, *, title, sub, console_image, phone_image, framed=True):
    """One job, both sides — the console on the left, the technician on the right."""
    slide = _blank(prs)
    _fill(slide, T.PAGE)

    _text(slide, T.MARGIN, Inches(0.46), Inches(11.6), Inches(1.0), [
        (title, T.HEADLINE_SIZE, T.INK, True, None),
    ] + ([(sub, T.SUB_SIZE, T.MUTED, False, Pt(6))] if sub else []))

    _picture(slide, str(console_image), T.MARGIN, Inches(1.75),
             Inches(8.1), Inches(5.1))
    _picture(slide, str(phone_image), Inches(9.15), Inches(1.55),
             Inches(3.6), Inches(5.5), shadow=False, device=not framed)
    return slide


def closing_slide(prs, *, title, lines, footer):
    slide = _blank(prs)
    _fill(slide, T.INK)

    runs = [(title, T.SECTION_SIZE, T.WHITE, True, None)]
    for line in lines:
        runs.append((line, Pt(15), T.ON_INK_MUTED, False, Pt(11)))

    _text(slide, T.MARGIN, Inches(2.3), Inches(9.8), Inches(3.6), runs)
    _text(slide, T.MARGIN, Inches(6.45), Inches(11.0), Inches(0.5),
          [(footer, T.FOOT_SIZE, T.ON_INK_MUTED, False, None)])
    return slide
