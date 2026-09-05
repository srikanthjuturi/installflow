"""The page a customer lands on to pick their appointment time.

Mounted OUTSIDE `/api/v1` and outside every guard — the only unauthenticated
write in the codebase. What makes that safe:

  * the token is 256 bits and single-use;
  * it names one appointment and nothing else, so there is no list to walk;
  * the page never reveals more than the customer already knows — their own
    product and their own address;
  * the windows are generated server-side from the ticket's own SLA, so a
    forged POST cannot book a time the company did not offer.

Server-rendered with no assets, for the same reasons as the technician invite
landing page: it is opened once, on a phone, often on a bad connection, and a
build pipeline for one page would be its own liability.
"""

import datetime
import html
from typing import Annotated

from fastapi import APIRouter, Depends, Form
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.features.tickets import service
from app.models.product import ProductModel

router = APIRouter(tags=["tickets"])

Db = Annotated[AsyncSession, Depends(get_db)]

_STYLE = """
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center;
    justify-content: center; padding: 26px;
    font-family: Roboto, -apple-system, "Segoe UI", sans-serif;
    background: #eef1f3; color: #141b22;
  }
  .card { width: 100%; max-width: 420px; }
  .mark {
    width: 58px; height: 58px; border-radius: 17px; background: #0e1622;
    color: #fff; display: grid; place-items: center;
    font-size: 22px; font-weight: 900;
  }
  h1 { font-size: 25px; line-height: 1.16; letter-spacing: -.5px; margin: 18px 0 8px; }
  p { font-size: 13.5px; line-height: 1.5; color: #5a6772; margin: 0 0 8px; }
  .meta {
    margin: 16px 0 6px; padding: 14px 16px; border-radius: 14px;
    background: #fff; border: 1.5px solid #e2e8ee;
  }
  .meta b { display: block; font-size: 15px; margin-bottom: 2px; }
  .meta span { font-size: 12.5px; color: #5a6772; }
  .day { margin: 20px 0 8px; font-size: 12px; font-weight: 700;
         text-transform: uppercase; letter-spacing: .6px; color: #8894a0; }
  .slot {
    display: flex; align-items: center; gap: 12px; width: 100%;
    margin-bottom: 8px; padding: 15px 16px; border-radius: 14px;
    border: 1.5px solid #d5dde4; background: #fff; color: #141b22;
    font-size: 15px; font-weight: 600; text-align: left; cursor: pointer;
    font-family: inherit;
  }
  .slot:hover { border-color: #1f6feb; }
  .slot:focus-visible { outline: 3px solid rgba(31,111,235,.4); outline-offset: 2px; }
  .ok {
    margin-top: 18px; padding: 16px; border-radius: 14px;
    background: #e7f6ec; border: 1.5px solid #b7dfc4;
    font-size: 15px; font-weight: 700; color: #14683a;
  }
  .warn {
    margin-top: 18px; padding: 16px; border-radius: 14px;
    background: #fdf3e3; border: 1.5px solid #f0d9ab;
    font-size: 14px; font-weight: 600; color: #8a5a12;
  }
  .note { margin-top: 16px; font-size: 12px; color: #8894a0; }
"""


def _page(title: str, body: str) -> HTMLResponse:
    return HTMLResponse(
        f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>{html.escape(title)}</title>
<style>{_STYLE}</style>
</head>
<body><div class="card"><div class="mark">RG</div>{body}</div></body>
</html>"""
    )


def _closed(heading: str, message: str) -> HTMLResponse:
    return _page(
        heading,
        f"<h1>{html.escape(heading)}</h1><p>{html.escape(message)}</p>"
        '<p class="note">If this is not what you expected, please call the '
        "number on your order confirmation.</p>",
    )


async def _render(db: AsyncSession, token: str, *, just_confirmed: bool):
    row = await service.load_by_token(db, token)
    product = await db.scalar(
        select(ProductModel.name).where(ProductModel.id == row.model_id)
    )
    name = html.escape(row.customer_name.split(" ")[0])
    meta = (
        f'<div class="meta"><b>{html.escape(product or "Your product")}</b>'
        f'<span>{html.escape(row.address)}, {html.escape(row.city)} '
        f"{html.escape(row.pincode)}</span></div>"
    )

    if row.slot_confirmed_at is not None or row.slot_start is not None:
        assert row.slot_start and row.slot_end  # both-or-neither, by CHECK
        when = service.when_label(row.slot_start, row.slot_end)
        heading = "You&rsquo;re all set" if just_confirmed else "Already confirmed"
        return _page(
            "Your visit is confirmed",
            f"<h1>{heading}</h1>"
            f"<p>Thanks, {name}. We&rsquo;ll see you then.</p>"
            f"{meta}"
            f'<div class="ok">{html.escape(when)}</div>'
            '<p class="note">Our technician will call before arriving. '
            "To change the time, please call us &mdash; this link can only be "
            "used once.</p>",
        )

    # Technician-aware: a job can be accepted before a time exists, so by now
    # somebody may be committed to this and the windows they cannot serve must
    # not be on the page. Offering one would book a visit that cannot happen.
    slots = await service.bookable_slots(db, row)
    if not slots:
        # A real outcome, not an error, and now with two causes: a 12-hour
        # ticket raised late in the evening has nothing left inside its window,
        # and a ticket whose technician has filled every remaining day has
        # nothing left either. The customer is told the same thing because the
        # remedy is the same — and because "your technician is busy" is our
        # problem to solve, not a fact to hand them.
        return _page(
            "No times left",
            "<h1>No times available</h1>"
            f"<p>Sorry {name} &mdash; we have run out of slots for this visit. "
            "Please call us and we will arrange one for you.</p>" + meta,
        )

    by_day: dict[str, list[str]] = {}
    for start, end in slots:
        local = start.astimezone(service.IST)
        # Built by hand rather than with `%-d`, which is a glibc extension and
        # raises on Windows — where this very much does get run.
        day = f"{local.strftime('%A')} {local.day} {local.strftime('%B')}"
        # 12-hour, like every other time the customer is shown. `clock_range`
        # is the same one the confirmation message and the timeline use, so a
        # customer cannot be offered `14:00` and then told `2:00 PM`.
        label = service.clock_range(start, end).replace("–", "&ndash;")
        by_day.setdefault(day, []).append(
            f'<button class="slot" name="start" value="{start.isoformat()}" '
            f"type=\"submit\">{label}</button>"
        )

    groups = "".join(
        f'<div class="day">{html.escape(day)}</div>' + "".join(buttons)
        for day, buttons in by_day.items()
    )
    return _page(
        "Pick a time",
        f"<h1>Pick a time</h1>"
        f"<p>Hello {name} &mdash; choose when it suits you, and we&rsquo;ll "
        "send a technician.</p>"
        f"{meta}"
        f'<form method="post">{groups}</form>'
        '<p class="note">Two-hour windows. Our technician will call before '
        "arriving.</p>",
    )


@router.get("/slot/{token}", response_class=HTMLResponse, include_in_schema=False)
async def slot_page(token: str, db: Db) -> HTMLResponse:
    try:
        return await _render(db, token, just_confirmed=False)
    except Exception:  # noqa: BLE001 — a customer must never see a stack trace
        return _closed(
            "Link not valid",
            "This scheduling link has expired or has already been used.",
        )


@router.post("/slot/{token}", response_class=HTMLResponse, include_in_schema=False)
async def choose_slot(
    token: str, db: Db, start: Annotated[str, Form()]
) -> HTMLResponse:
    try:
        chosen = datetime.datetime.fromisoformat(start)
    except ValueError:
        return _closed("Something went wrong", "Please open the link again.")

    try:
        await service.confirm_slot(db, token, chosen)
    except Exception:  # noqa: BLE001
        # Most likely: somebody else confirmed it, or the window passed while
        # the page sat open. Re-render, which shows whichever is true.
        return await slot_page(token, db)

    return await _render(db, token, just_confirmed=True)
