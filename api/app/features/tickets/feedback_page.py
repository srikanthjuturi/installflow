"""The page a customer lands on to confirm the work was actually done.

The second unauthenticated write in the codebase, and the more consequential
one: `slot_page` books a two-hour appointment, this one CLOSES a job. What makes
it safe is the same set of properties, and they are worth restating rather than
assumed:

  * the token is 256 bits and single-use;
  * it names one visit and nothing else, so there is no list to walk;
  * the page reveals nothing the customer does not already know — their own
    product, their own address, and the name of the person who just left it;
  * neither answer can be forged into something the company did not offer: the
    only choices are yes and no, and the ticket decides which statuses those
    map to.

Why this exists at all: before it, a job was closed by the technician saying so.
The whole point of the link is that the person who did the work is not the
person who gets to declare it finished.

Server-rendered with no assets, for the same reason as the slot page — it is
opened once, on a phone, often on a bad connection.
"""

import html
from typing import Annotated

from fastapi import APIRouter, Depends, Form
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.features.tickets import feedback_service as service
from app.models.product import ProductModel

router = APIRouter(tags=["tickets"])

Db = Annotated[AsyncSession, Depends(get_db)]

#: The slot page's stylesheet plus what this page adds: a star row and the two
#: decision buttons. Duplicated rather than imported because the two pages are
#: allowed to diverge — this one has to work when the answer is "no", and that
#: is a different visual problem from picking a time.
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
  .label { margin: 20px 0 8px; font-size: 12px; font-weight: 700;
           text-transform: uppercase; letter-spacing: .6px; color: #8894a0; }
  .opt { font-weight: 500; text-transform: none; letter-spacing: 0; color: #a6b0bb; }

  /* Radio stars. No JavaScript: the inputs are the state, and `direction:rtl`
     with a sibling selector is what lets hovering a star light the ones before
     it. A customer on a dying phone should not need a script to answer. */
  .stars { display: flex; flex-direction: row-reverse; justify-content: flex-end; gap: 4px; }
  .stars input { position: absolute; opacity: 0; width: 0; height: 0; }
  .stars label {
    font-size: 34px; line-height: 1; color: #d5dde4; cursor: pointer;
    transition: color .12s;
  }
  .stars input:checked ~ label, .stars label:hover, .stars label:hover ~ label {
    color: #f5b40a;
  }
  .stars input:focus-visible + label { outline: 3px solid rgba(31,111,235,.4); }

  textarea {
    width: 100%; margin-top: 6px; padding: 13px 14px; border-radius: 14px;
    border: 1.5px solid #d5dde4; background: #fff; font-family: inherit;
    font-size: 14.5px; line-height: 1.45; color: #141b22; resize: vertical;
    min-height: 88px;
  }
  textarea:focus-visible { outline: 3px solid rgba(31,111,235,.4); border-color: #1f6feb; }

  button {
    display: block; width: 100%; margin-top: 10px; padding: 16px;
    border-radius: 14px; font-family: inherit; font-size: 15.5px;
    font-weight: 700; cursor: pointer; border: 1.5px solid transparent;
  }
  .yes { background: #15803d; color: #fff; }
  .yes:hover { background: #126a33; }
  .no { background: #fff; color: #c81e1e; border-color: #f0c2c2; }
  .no:hover { background: #fdecec; }
  button:focus-visible { outline: 3px solid rgba(31,111,235,.4); outline-offset: 2px; }

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


def _stars() -> str:
    """Five radio inputs, rendered largest-first so CSS can light a prefix.

    Deliberately NOT `required`. It was, and that quietly made the rating a
    condition of complaining: the "No, there's a problem" button is in the same
    form, so a customer whose installation was left half-finished could not tell
    us until they had first scored it out of five. The people most likely to
    abandon at that point are exactly the ones we most need to hear from.
    """
    return '<div class="stars">' + "".join(
        f'<input type="radio" id="s{n}" name="rating" value="{n}">'
        f'<label for="s{n}" title="{n} out of 5">&#9733;</label>'
        for n in (5, 4, 3, 2, 1)
    ) + "</div>"


async def _render(db: AsyncSession, token: str, *, just_answered: bool):
    row = await service.load_by_feedback_token(db, token)
    product = await db.scalar(
        select(ProductModel.name).where(ProductModel.id == row.model_id)
    )
    name = html.escape(row.customer_name.split(" ")[0])
    meta = (
        f'<div class="meta"><b>{html.escape(product or "Your product")}</b>'
        f"<span>{html.escape(row.address)}, {html.escape(row.city)} "
        f"{html.escape(row.pincode)}</span></div>"
    )

    if row.customer_confirmed_at is not None:
        # Already answered — show them which way, so a second tap on the same
        # WhatsApp message is reassuring rather than confusing.
        if row.status == "Escalated":
            return _page(
                "We're looking into it",
                "<h1>We&rsquo;re on it</h1>"
                f"<p>Thanks {name} — you told us this job was not finished, and "
                "it has gone to a service manager.</p>"
                f"{meta}"
                '<div class="warn">Reported as not complete. Someone will '
                "contact you.</div>"
                '<p class="note">This link can only be used once.</p>',
            )
        heading = "Thank you" if just_answered else "Already confirmed"
        return _page(
            "Visit confirmed",
            f"<h1>{heading}</h1>"
            f"<p>Thanks {name} — you confirmed this installation is complete.</p>"
            f"{meta}"
            '<div class="ok">Confirmed &mdash; this job is closed.</div>'
            '<p class="note">This link can only be used once.</p>',
        )

    technician = await service.technician_name(db, row)
    return _page(
        "Confirm your installation",
        "<h1>Is your installation complete?</h1>"
        f"<p>Hello {name} — {html.escape(technician)} has marked this job as "
        "finished. Please confirm, so we know it was done properly.</p>"
        f"{meta}"
        '<form method="post">'
        '<div class="label">How was it? <span class="opt">optional</span></div>'
        f"{_stars()}"
        '<div class="label">Anything you want to tell us?</div>'
        '<textarea name="comment" maxlength="1000" '
        'placeholder="Optional"></textarea>'
        '<button class="yes" name="answer" value="yes" type="submit">'
        "Yes, it&rsquo;s complete</button>"
        '<button class="no" name="answer" value="no" type="submit">'
        "No, there&rsquo;s a problem</button>"
        "</form>"
        '<p class="note">Your answer is what closes this job. If something is '
        "wrong, say so &mdash; it goes straight to a service manager.</p>",
    )


@router.get("/feedback/{token}", response_class=HTMLResponse, include_in_schema=False)
async def feedback_page(token: str, db: Db) -> HTMLResponse:
    try:
        return await _render(db, token, just_answered=False)
    except Exception:  # noqa: BLE001 — a customer must never see a stack trace
        return _closed(
            "Link not valid",
            "This confirmation link has expired or has already been used.",
        )


@router.post("/feedback/{token}", response_class=HTMLResponse, include_in_schema=False)
async def submit_feedback(
    token: str,
    db: Db,
    answer: Annotated[str, Form()],
    rating: Annotated[int | None, Form()] = None,
    comment: Annotated[str, Form()] = "",
) -> HTMLResponse:
    if answer not in ("yes", "no"):
        return _closed("Something went wrong", "Please open the link again.")

    try:
        await service.record_feedback(
            db, token, confirmed=answer == "yes", rating=rating, comment=comment
        )
    except Exception:  # noqa: BLE001
        # Most likely: answered already, in another tab or on another tap.
        # Re-render, which shows whichever is now true.
        return await feedback_page(token, db)

    return await _render(db, token, just_answered=True)
