"""Assemble both decks from `out/shots.json`.

    deck/.venv/Scripts/python.exe build/build_deck.py

Produces:
    dist/Reliance GreenTech - Product Overview.pptx   the pitch deck
    dist/Reliance GreenTech - Screen Catalogue.pptx    the leave-behind

A slide whose screenshot is missing is skipped with a warning rather than
crashing the build, so a partial capture still yields a usable deck. The summary
at the end names every skip, so a missing screen can never pass unnoticed.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from pptx import Presentation  # noqa: E402

import layouts as L  # noqa: E402
import storyboard as S  # noqa: E402
import theme as T  # noqa: E402

DECK_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = DECK_ROOT.parent
SHOTS_JSON = DECK_ROOT / "out" / "shots.json"
DIST = DECK_ROOT / "dist"

# python-pptx cannot place an SVG, so the mark is the app icon rather than
# adminWeb/public/reliance-greentech.svg.
MARK = REPO_ROOT / "mobileapp" / "assets" / "icon.png"

skipped: list[str] = []


def new_presentation() -> Presentation:
    prs = Presentation()
    prs.slide_width = T.SLIDE_W
    prs.slide_height = T.SLIDE_H
    return prs


def resolve(shots: dict, shot_id: str) -> Path | None:
    shot = shots.get(shot_id)
    if shot is None:
        skipped.append(f"{shot_id} — not captured")
        return None
    path = DECK_ROOT / shot["file"]
    if not path.exists():
        skipped.append(f"{shot_id} — PNG missing at {shot['file']}")
        return None
    return path


def is_framed(shots: dict, shot_id: str) -> bool:
    """Prototype shots arrive with the device drawn; real-app and customer-page
    shots are bare rectangles and need one drawn on the slide."""
    return shots.get(shot_id, {}).get("kind") != "phone-raw"


def is_console(shots: dict, shot_id: str) -> bool:
    return shots.get(shot_id, {}).get("kind") == "console"


def build_overview(shots: dict) -> Presentation:
    prs = new_presentation()

    L.title_slide(prs, title=S.TITLE["title"], subtitle=S.TITLE["subtitle"],
                  footer=f"{S.TITLE['footer']} · {T.today()}", mark=MARK)

    for entry in S.STORY:
        kind = entry["kind"]

        if kind == "section":
            L.section_slide(prs, eyebrow=entry["eyebrow"], title=entry["title"])

        elif kind in ("console", "phone"):
            shot_id = entry["shot"]
            image = resolve(shots, shot_id)
            if image is None:
                continue
            if kind == "console":
                L.console_slide(prs, title=entry["title"],
                                sub=entry.get("sub", ""), image=image)
            else:
                L.phone_slide(prs, title=entry["title"], sub=entry.get("sub", ""),
                              image=image, framed=is_framed(shots, shot_id))

        elif kind == "grid":
            ids = [sid for sid in entry["shots"] if resolve(shots, sid) is not None]
            images = [DECK_ROOT / shots[sid]["file"] for sid in ids]
            if not images:
                continue
            L.phone_grid_slide(prs, title=entry["title"], sub=entry.get("sub", ""),
                               images=images, captions=entry.get("captions", []),
                               framed=is_framed(shots, ids[0]))

        elif kind == "split":
            console_id, phone_id = entry["console"], entry["phone"]
            console_img = resolve(shots, console_id)
            phone_img = resolve(shots, phone_id)
            if console_img is None or phone_img is None:
                # Degrade rather than drop the step: whichever half exists still
                # makes the point.
                if console_img is not None:
                    L.console_slide(prs, title=entry["title"],
                                    sub=entry.get("sub", ""), image=console_img)
                elif phone_img is not None:
                    L.phone_slide(prs, title=entry["title"], sub=entry.get("sub", ""),
                                  image=phone_img, framed=is_framed(shots, phone_id))
                continue
            L.split_slide(prs, title=entry["title"], sub=entry.get("sub", ""),
                          console_image=console_img, phone_image=phone_img,
                          framed=is_framed(shots, phone_id))

    L.closing_slide(prs, title=S.CLOSING["title"], lines=S.CLOSING["lines"],
                    footer=f"{S.CLOSING['footer']} · {T.today()}")
    return prs


def build_catalogue(shots: list) -> Presentation:
    prs = new_presentation()

    L.title_slide(
        prs,
        title="Every screen,\nin order",
        subtitle="The complete surface of the platform — ops console, vendor\n"
                 "portal, technician app and the pages the customer sees.",
        footer=f"Screen catalogue · {T.today()}",
        mark=MARK,
    )

    in_catalogue = [s for s in shots if s.get("catalogue", True)]
    sections = {}
    for shot in in_catalogue:
        sections.setdefault(shot["section"], []).append(shot)

    ordered = [s for s in S.SECTION_ORDER if s in sections]
    ordered += [s for s in sections if s not in S.SECTION_ORDER]

    for section in ordered:
        L.section_slide(prs, eyebrow=S.SECTION_EYEBROWS.get(section, "Screens"),
                        title=section)

        for shot in sections[section]:
            path = DECK_ROOT / shot["file"]
            if not path.exists():
                skipped.append(f"{shot['id']} — PNG missing")
                continue
            if shot["kind"] == "console":
                L.console_slide(prs, title=shot["title"], sub=shot.get("sub", ""),
                                image=path)
            else:
                L.phone_slide(prs, title=shot["title"], sub=shot.get("sub", ""),
                              image=path, framed=shot["kind"] != "phone-raw")

    L.closing_slide(
        prs,
        title="Built to be handed over",
        lines=[
            "Every surface carries the client's own brand.",
            "Nothing on these screens is mocked — the data is live.",
        ],
        footer=f"Screen catalogue · {T.today()}",
    )
    return prs


def main() -> int:
    if not SHOTS_JSON.exists():
        print(f"no {SHOTS_JSON.relative_to(DECK_ROOT)} — run `npm run capture` first")
        return 1

    shots = json.loads(SHOTS_JSON.read_text(encoding="utf8"))
    by_id = {shot["id"]: shot for shot in shots}
    DIST.mkdir(exist_ok=True)

    overview = build_overview(by_id)
    overview_path = DIST / "Reliance GreenTech - Product Overview.pptx"
    overview.save(overview_path)

    catalogue = build_catalogue(shots)
    catalogue_path = DIST / "Reliance GreenTech - Screen Catalogue.pptx"
    catalogue.save(catalogue_path)

    print(f"{len(shots)} shot(s) available")
    print(f"  {overview_path.name}: {len(overview.slides._sldIdLst)} slides")
    print(f"  {catalogue_path.name}: {len(catalogue.slides._sldIdLst)} slides")

    if skipped:
        print(f"\n{len(skipped)} slide(s) skipped for want of a screenshot:")
        for item in dict.fromkeys(skipped):
            print(f"  - {item}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
