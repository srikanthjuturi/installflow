"""The experience map, as a Word document.

    deck/.venv/Scripts/python.exe build/build_map_document.py

Produces:
    dist/Reliance GreenTech - Product Experience Map.docx

Why this exists beside the .png and the .pdf: those are one continuous poster
nearly sixteen feet tall, which is right for reading on a screen and wrong for
anything else. This is the same map, same journeys, same order, paginated — so
it can be printed, emailed, marked up, or dropped into somebody else's pack.

## One source of truth

Every word and every screenshot comes from `out/experience-map/journeys.json`,
which `experience-map/build.mjs` writes from `journeys.mjs` while it builds the
page. Nothing is restated here. Re-order the map and both versions move
together; restating the journeys in Python is exactly how the two would end up
disagreeing about what step four is.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from docx import Document  # noqa: E402
from docx.shared import Cm, Pt  # noqa: E402

import docx_kit as K  # noqa: E402

DECK_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = DECK_ROOT.parent
JOURNEYS = DECK_ROOT / "out" / "experience-map" / "journeys.json"
DIST = DECK_ROOT / "dist"
MARK = REPO_ROOT / "mobileapp" / "assets" / "icon.png"

missing: list[str] = []


def shot_path(shot: dict) -> Path | None:
    """Where a shot's PNG is, recording it rather than drawing nothing."""
    path = DECK_ROOT / shot["file"]
    if not path.exists():
        missing.append(f"{shot['id']} — PNG missing at {shot['file']}")
        return None
    return path


def caption_for(shot: dict) -> str:
    """The approved caption: headline, then the supporting line if there is one."""
    title = (shot.get("title") or "").strip()
    sub = (shot.get("sub") or "").strip()
    if title and sub:
        return f"{title} — {sub}"
    return title or sub or shot["id"]


def draw_journey(document, journey: dict) -> None:
    label = journey["title"]
    if journey.get("step"):
        label = f"Step {journey['step']} — {label}"
    K.h2(document, label)

    # Who is on screen. The page says this with colour; a printed document has
    # to say it in words, and it is the one thing that makes the hand-offs
    # between parties legible at all.
    K.p(document, journey["actorLabel"], size=Pt(9), colour=K.ACCENT, space_after=6)

    shots = [s for s in journey["shots"] if shot_path(s) is not None]
    if not shots:
        return

    phones = [s for s in shots if s["kind"] != "console"]
    consoles = [s for s in shots if s["kind"] == "console"]

    # Phones in rows of up to four; a console screenshot is 8:5 and full of
    # small type, so it gets the full text column to itself.
    for start in range(0, len(phones), 4):
        batch = phones[start : start + 4]
        paths = [shot_path(s) for s in batch]
        captions = [caption_for(s) for s in batch]
        if len(batch) == 1:
            K.figure(document, paths[0], captions[0], width_cm=6.0)
        else:
            K.figure_row(document, paths, captions, height_cm=8.0)

    for shot in consoles:
        K.figure(document, shot_path(shot), caption_for(shot))


def build(data: dict) -> Document:
    document = K.configure(Document())

    K.title_block(
        document,
        eyebrow="Installation & Demo platform",
        title="Product experience map",
        subtitle=(
            "Every journey in the product, in the order it happens — from the "
            "platform creating your company to the money reaching a "
            "technician's bank."
        ),
        mark=MARK if MARK.exists() else None,
    )
    K.callout(document, data["demoNote"])

    total = sum(len(j["shots"]) for a in data["acts"] for j in a["journeys"])
    K.p(
        document,
        f"{total} screens · {sum(len(a['journeys']) for a in data['acts'])} journeys · "
        f"{len(data['acts'])} parts",
        size=Pt(9),
        colour=K.MUTED,
    )

    for act in data["acts"]:
        # One part per page. A journey that starts halfway down a page under the
        # tail of the previous one is the fastest way to lose the order this map
        # exists to show.
        K.h1(document, act["title"].replace("\n", " "))
        K.p(document, act["eyebrow"], size=Pt(9), colour=K.ACCENT, space_after=6)
        K.p(document, act["lede"], colour=K.MUTED)
        if act.get("unbuilt"):
            K.callout(
                document,
                "**These screens are designed and are not switched on.** They are "
                "shown so nothing comes as a surprise later, not as something you "
                "can use today.",
            )
        for journey in act["journeys"]:
            draw_journey(document, journey)

    K.h1(document, data["closing"]["title"])
    for line in data["closing"]["lines"]:
        K.bullet(document, line)

    K.footer_text(
        document,
        f"Installation & Demo platform — product experience map · {data['stamp']}",
    )
    return document


def main() -> int:
    if not JOURNEYS.exists():
        print("no out/experience-map/journeys.json — run `node experience-map/build.mjs` first")
        return 1

    data = json.loads(JOURNEYS.read_text(encoding="utf8"))
    DIST.mkdir(exist_ok=True)

    document = build(data)
    path = DIST / "Reliance GreenTech - Product Experience Map.docx"
    document.save(path)

    print(f"{path.name}: {len(document.paragraphs)} paragraphs, "
          f"{len(document.inline_shapes)} images")

    if missing:
        print(f"\n{len(set(missing))} screenshot(s) referenced but not drawn:")
        for item in sorted(set(missing)):
            print(f"  - {item}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
