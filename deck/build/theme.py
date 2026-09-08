"""Design tokens for the decks.

Taken from the product's own palette rather than invented: the ink and page
colours are the ones the customer-facing slot and feedback pages set inline
(`api/app/features/tickets/slot_page.py`), and the accent is the same blue the
console and the technician app use for a primary action. A deck that does not
match the screenshots on it looks like somebody else's deck.
"""

import datetime

from pptx.util import Emu, Inches, Pt
from pptx.dml.color import RGBColor

# ── Palette ──────────────────────────────────────────────────────────────────
INK = RGBColor(0x14, 0x1B, 0x22)        # near-black; the app's own dark ground
PAGE = RGBColor(0xEE, 0xF1, 0xF3)       # the customer pages' background
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
ACCENT = RGBColor(0x1F, 0x6F, 0xEB)     # primary action blue
SUCCESS = RGBColor(0x14, 0x68, 0x3A)
MUTED = RGBColor(0x5A, 0x67, 0x72)
BORDER = RGBColor(0xE2, 0xE8, 0xEE)
ON_INK = RGBColor(0xE8, 0xED, 0xF2)     # text on the dark ground
ON_INK_MUTED = RGBColor(0x93, 0xA2, 0xB0)

# ── Type ─────────────────────────────────────────────────────────────────────
# Roboto is what both clients ship. PowerPoint substitutes if a machine lacks
# it, which is why the fallback is named rather than left to chance.
FONT = "Roboto"
FONT_FALLBACK = "Segoe UI"

TITLE_SIZE = Pt(40)      # the deck's own title slide
HEADLINE_SIZE = Pt(28)   # a screenshot slide's 3-6 word headline
SUB_SIZE = Pt(14)
SECTION_SIZE = Pt(34)
EYEBROW_SIZE = Pt(11)
FOOT_SIZE = Pt(9)

# ── Geometry ─────────────────────────────────────────────────────────────────
SLIDE_W = Inches(13.333)
SLIDE_H = Inches(7.5)
MARGIN = Inches(0.62)


def fit(box_w: int, box_h: int, img_w: int, img_h: int) -> tuple[int, int]:
    """Largest (w, h) with the image's aspect ratio that fits inside the box.

    Always contain, never crop and never stretch — a squashed screenshot is the
    fastest way to make a real product look fake.
    """
    scale = min(box_w / img_w, box_h / img_h)
    return Emu(int(img_w * scale)), Emu(int(img_h * scale))


def centre(outer_pos: int, outer_size: int, inner_size: int) -> int:
    return Emu(int(outer_pos + (outer_size - inner_size) / 2))


def today() -> str:
    """`7 September 2026`, stamped at build time.

    A deck of screenshots is a moment in time, and an undated one quietly stops
    saying which moment — which matters here, because the product ships several
    times a day.

    Written by hand rather than with `%-d`, which the C runtime on Windows does
    not support and which would print `07`.
    """
    now = datetime.date.today()
    return f"{now.day} {now:%B %Y}"
