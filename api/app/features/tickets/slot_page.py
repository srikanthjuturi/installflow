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
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Form, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import brand
from app.core.customer_location import (
    FAR_FROM_PINCODE_M,
    SOURCE_CUSTOMER,
    may_customer_set,
    validate_point,
)
from app.core.errors import AppError
from app.core.database import get_db
from app.core.slots import time_is_choosable
from app.features.tickets import service
from app.models.company import Company
from app.models.product import ProductModel

router = APIRouter(tags=["tickets"])
log = logging.getLogger(__name__)

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


_LOCATION_STYLE = """
  .loc { margin: 22px 0 8px; }
  .loc h2 { font-size: 16px; margin: 0 0 4px; }
  #map { height: 240px; border-radius: 14px; border: 1.5px solid #d5dde4; margin: 10px 0; }
  .btn {
    display: inline-block; padding: 12px 16px; border-radius: 12px;
    border: 1.5px solid #d5dde4; background: #fff; color: #141b22;
    font-size: 14px; font-weight: 600; font-family: inherit; cursor: pointer;
    margin: 0 8px 8px 0;
  }
  .btn.primary { background: #0e1622; border-color: #0e1622; color: #fff; }
  .btn:disabled { opacity: .45; cursor: default; }
  .srch { display: flex; gap: 8px; margin: 10px 0 0; }
  .srch input {
    flex: 1; min-width: 0; padding: 12px 14px; border-radius: 12px;
    border: 1.5px solid #d5dde4; font-size: 14px; font-family: inherit;
  }
  .srch .btn { margin: 0; }
  #loc-res { list-style: none; margin: 8px 0 0; padding: 0; }
  #loc-res li { margin: 0 0 6px; }
  #loc-res button {
    width: 100%; text-align: left; padding: 10px 12px; border-radius: 10px;
    border: 1.5px solid #e2e8ee; background: #fff; font-size: 13px;
    font-family: inherit; color: #141b22; cursor: pointer;
  }
  #loc-msg { font-size: 12.5px; color: #8894a0; margin: 6px 0 0; }
  .err { margin-top: 14px; padding: 12px 14px; border-radius: 12px;
         background: #fdecec; border: 1.5px solid #f0b8b8; color: #8a1f1f;
         font-size: 13.5px; font-weight: 600; }
"""

# ── copy for the customer's location. New wording, gathered here so it can be
# reviewed in one place before it ships.
_LOC_HEADING = "Where should we come?"
_LOC_HELP = (
    "Search for your address, move the pin to your door, or use your current "
    "location. This helps our technician find you."
)
_LOC_SAVE = "Save my location"
_LOC_USE_GPS = "Use my current location"
_LOC_CONFIRM_PIN = "This is the right place"
_LOC_SEARCH_PLACEHOLDER = "Search your address or landmark"
_LOC_SEARCH = "Search"
_LOC_NO_RESULTS = "Nothing found. Try a nearby landmark, or move the pin."
_LOC_SEARCH_DOWN = "Search is not available right now. You can still move the pin."
#: `{km}` is filled in by the page script.
_LOC_FAR = "This is about {km} km from your pincode area. Please check the pin before saving."
_LOC_SAVED = "Your location is saved."
_LOC_SAVED_HEADING = "Your location"
_LOC_HELD = "Your technician has been assigned, so the location can no longer be changed here."

_LEAFLET = (
    '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/'
    'leaflet/1.9.4/leaflet.css">'
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/'
    'leaflet.js"></script>'
)

# No template literals and no braces in the HTML around it: this string is
# spliced in with `.replace`, not formatted.
#
# Address search is the browser asking OpenStreetMap's Nominatim directly, once
# per press of Search (never per keystroke — its usage policy forbids
# autocomplete). The server learns nothing, which is the rule this codebase
# keeps for every map provider. Results are written with `textContent`, never as
# HTML: they are text from a third party.
_LOC_SCRIPT = """
<script>
(function () {
  var box = document.getElementById('loc');
  if (!box || !window.L) { return; }              // no map: the page works as before
  box.hidden = false;
  var readonly = box.dataset.readonly === '1';
  var start = box.dataset.lat ? [parseFloat(box.dataset.lat), parseFloat(box.dataset.lng)] : null;
  var centre = box.dataset.clat ? [parseFloat(box.dataset.clat), parseFloat(box.dataset.clng)] : null;
  var farM = box.dataset.far ? parseFloat(box.dataset.far) : 0;
  var map = L.map('map').setView(start || centre || [21.0, 78.0], start ? 16 : (centre ? 14 : 5));
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  if (readonly) { if (start) { L.marker(start).addTo(map); } return; }

  var latIn = document.getElementById('lat'), lngIn = document.getElementById('lng');
  var save = document.getElementById('loc-save'), ok = document.getElementById('loc-ok');
  var far = document.getElementById('loc-far');
  var pin = null;

  function metres(a, b, c, d) {
    var r = Math.PI / 180, dp = (c - a) * r, dl = (d - b) * r;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) +
            Math.cos(a * r) * Math.cos(c * r) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 12742000 * Math.asin(Math.sqrt(h));
  }
  function warn(lat, lng) {
    if (!far) { return; }
    var away = centre && farM ? metres(lat, lng, centre[0], centre[1]) : 0;
    if (away > farM) {
      far.textContent = far.dataset.text.replace('{km}', String(Math.round(away / 1000)));
      far.hidden = false;
    } else { far.hidden = true; }
  }
  function put(lat, lng, chosen) {
    if (!pin) {
      pin = L.marker([lat, lng], { draggable: true }).addTo(map);
      pin.on('dragend', function () { var p = pin.getLatLng(); put(p.lat, p.lng, true); });
    } else { pin.setLatLng([lat, lng]); }
    if (chosen) {
      latIn.value = lat.toFixed(6); lngIn.value = lng.toFixed(6);
      if (save) { save.disabled = false; }
      warn(lat, lng);
    }
  }
  if (start) { put(start[0], start[1], false); if (ok) { ok.hidden = false; } }
  map.on('click', function (e) { put(e.latlng.lat, e.latlng.lng, true); });

  var gps = document.getElementById('loc-gps');
  if (gps && navigator.geolocation) {
    gps.hidden = false;
    gps.addEventListener('click', function () {
      navigator.geolocation.getCurrentPosition(function (r) {
        put(r.coords.latitude, r.coords.longitude, true);
        map.setView([r.coords.latitude, r.coords.longitude], 17);
      }, function () {}, { enableHighAccuracy: true, timeout: 15000 });
    });
  }
  if (ok) {
    ok.addEventListener('click', function () {
      var p = pin.getLatLng(); put(p.lat, p.lng, true);
    });
  }

  var q = document.getElementById('loc-q'), find = document.getElementById('loc-find');
  var res = document.getElementById('loc-res'), msg = document.getElementById('loc-msg');
  function say(text) { msg.textContent = text; }
  function search() {
    var text = q.value.trim();
    res.textContent = ''; say('');
    if (text.length < 3) { return; }
    fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=in&limit=5&q=' +
          encodeURIComponent(text))
      .then(function (r) { return r.json(); })
      .then(function (list) {
        if (!list.length) { say(box.dataset.none); return; }
        list.forEach(function (item) {
          var li = document.createElement('li'), b = document.createElement('button');
          b.type = 'button'; b.textContent = item.display_name;
          b.addEventListener('click', function () {
            var lat = parseFloat(item.lat), lng = parseFloat(item.lon);
            put(lat, lng, true); map.setView([lat, lng], 17); res.textContent = '';
          });
          li.appendChild(b); res.appendChild(li);
        });
      })
      .catch(function () { say(box.dataset.down); });
  }
  if (q && find) {
    find.addEventListener('click', search);
    // Enter must search, not submit the page's form — on the time picker that
    // would book the first window.
    q.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); search(); }
    });
  }
})();
</script>
"""


def _location_block(
    pin: tuple[float | None, float | None],
    centre: tuple[float | None, float | None],
    *,
    with_save: bool,
    readonly: bool = False,
) -> str:
    """The map section. Hidden until the map library has loaded, so a customer
    whose browser cannot load it sees today's page and loses nothing.

    `pin` is a point somebody already vouched for (the vendor's pick, or the
    customer's own once saved); `centre` is the pincode's centre — where the map
    opens when there is no pin, and what the far-away warning measures from.
    `readonly` draws the saved point and nothing to change it with."""
    data = ""
    if pin[0] is not None and pin[1] is not None:
        data += f' data-lat="{pin[0]}" data-lng="{pin[1]}"'
    if centre[0] is not None and centre[1] is not None:
        data += f' data-clat="{centre[0]}" data-clng="{centre[1]}"'
        data += f' data-far="{FAR_FROM_PINCODE_M}"'
    if readonly:
        return (
            f'<div class="loc" id="loc" hidden data-readonly="1"{data}>'
            f"<h2>{html.escape(_LOC_SAVED_HEADING)}</h2>"
            '<div id="map"></div></div>'
        )
    data += (
        f' data-none="{html.escape(_LOC_NO_RESULTS, quote=True)}"'
        f' data-down="{html.escape(_LOC_SEARCH_DOWN, quote=True)}"'
    )
    save = (
        f'<button class="btn primary" id="loc-save" type="submit" disabled>'
        f"{html.escape(_LOC_SAVE)}</button>"
        if with_save
        else ""
    )
    return (
        f'<div class="loc" id="loc" hidden{data}>'
        f"<h2>{html.escape(_LOC_HEADING)}</h2><p>{html.escape(_LOC_HELP)}</p>"
        # No `name` on the search box: it is never submitted with the form.
        '<div class="srch">'
        f'<input type="search" id="loc-q" autocomplete="off" '
        f'placeholder="{html.escape(_LOC_SEARCH_PLACEHOLDER, quote=True)}">'
        f'<button class="btn" id="loc-find" type="button">{html.escape(_LOC_SEARCH)}</button>'
        "</div>"
        '<ul id="loc-res"></ul><p id="loc-msg"></p>'
        '<div id="map"></div>'
        f'<div class="warn" id="loc-far" hidden data-text="{html.escape(_LOC_FAR, quote=True)}"></div>'
        f'<button class="btn" id="loc-gps" type="button" hidden>{html.escape(_LOC_USE_GPS)}</button>'
        f'<button class="btn" id="loc-ok" type="button" hidden>{html.escape(_LOC_CONFIRM_PIN)}</button>'
        '<input type="hidden" name="lat" id="lat"><input type="hidden" name="lng" id="lng">'
        f"{save}</div>"
    )


def _page(
    title: str, body: str, *, mark: str | None = None, with_map: bool = False
) -> HTMLResponse:
    """The shell. `mark` is the company's short code once the ticket is known.

    It falls back to the platform's on the error paths, where a token that
    resolved to nothing leaves no company to name — never to a guess.
    """
    return HTMLResponse(
        f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>{html.escape(title)}</title>
<style>{_STYLE}{_LOCATION_STYLE}</style>{_LEAFLET if with_map else ''}
</head>
<body><div class="card"><div class="mark">{html.escape(brand.company_mark(mark))}</div>{body}</div>{_LOC_SCRIPT if with_map else ''}</body>
</html>"""
    )


def _closed(heading: str, message: str, *, mark: str | None = None) -> HTMLResponse:
    return _page(
        heading,
        f"<h1>{html.escape(heading)}</h1><p>{html.escape(message)}</p>"
        '<p class="note">If this is not what you expected, please call the '
        "number on your order confirmation.</p>",
        mark=mark,
    )


def _error(message: str | None) -> str:
    return f'<div class="err">{html.escape(message)}</div>' if message else ""


async def _render(
    db: AsyncSession,
    token: str,
    *,
    just_confirmed: bool,
    location_error: str | None = None,
):
    row = await service.load_by_token(db, token)
    product = await db.scalar(
        select(ProductModel.name).where(ProductModel.id == row.model_id)
    )
    # Whose visit this is. The ticket names its company, and this page already
    # shows the customer their own address — so the company installing their
    # product is strictly less than it reveals already.
    mark = await db.scalar(
        select(Company.code).where(Company.id == row.company_id)
    )
    name = html.escape(row.customer_name.split(" ")[0])
    meta = (
        f'<div class="meta"><b>{html.escape(product or "Your product")}</b>'
        f'<span>{html.escape(row.address)}, {html.escape(row.city)} '
        f"{html.escape(row.pincode)}</span></div>"
    )

    # The location half of the page. Offered while the customer may still set it
    # (`may_customer_set`), shown as saved once they have, and otherwise absent.
    can_locate = may_customer_set(row.location_source, row.technician_id, row.status)
    located = row.location_source == SOURCE_CUSTOMER
    # The pin starts where the vendor said, if they did. The pincode's centre is
    # only where the map OPENS — never a pin, because the customer has said
    # nothing yet and nothing may be saved by default.
    pin = (row.latitude, row.longitude)
    centre = (None, None)
    if can_locate:
        centre = await service._pincode_centre(db, row.pincode)
    saved_note = (
        f'<div class="ok">{html.escape(_LOC_SAVED)}</div>' if located else ""
    )
    # Once saved, show WHERE — not only that it was.
    if located and pin[0] is not None:
        saved_note += _location_block(pin, (None, None), with_save=False, readonly=True)
    held_note = (
        f'<p class="note">{html.escape(_LOC_HELD)}</p>'
        if not can_locate and not located and row.technician_id is not None
        else ""
    )

    if row.slot_confirmed_at is not None or row.slot_start is not None:
        assert row.slot_start and row.slot_end  # both-or-neither, by CHECK
        when = service.when_label(row.slot_start, row.slot_end)
        if just_confirmed:
            heading = "You&rsquo;re all set"
        elif row.slot_confirmed_at is not None:
            heading = "Already confirmed"
        else:
            heading = "Your visit is booked"
        form = (
            f'<form method="post" action="/slot/{html.escape(token)}/location">'
            + _location_block(pin, centre, with_save=True)
            + "</form>"
            if can_locate
            else ""
        )
        return _page(
            "Your visit is confirmed",
            f"<h1>{heading}</h1>"
            f"<p>Thanks, {name}. We&rsquo;ll see you then.</p>"
            f"{meta}"
            f'<div class="ok">{html.escape(when)}</div>'
            f"{saved_note}{_error(location_error)}{form}{held_note}"
            '<p class="note">Our technician will call before arriving. '
            "To change the time, please call us.</p>",
            mark=mark,
            with_map=can_locate or located,
        )

    # No time, and none can be chosen any more: the job is under way, refused or
    # settled. Drawing the picker anyway was the bug — the customer tapped a
    # window, `confirm_slot` refused, and the page re-rendered the same picker,
    # for ever. The words are the invalid-link page's own, because that is what
    # this link now is, and they stay under the company's mark since it is known.
    if not time_is_choosable(row.status, row.technician_id):
        return _closed(
            "Link not valid",
            "This scheduling link has expired or has already been used.",
            mark=mark,
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
            mark=mark,
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
    # The location comes FIRST: tapping a window submits the form, so a point
    # chosen after it would be lost.
    where = _location_block(pin, centre, with_save=False) if can_locate else saved_note
    return _page(
        "Pick a time",
        f"<h1>Pick a time</h1>"
        f"<p>Hello {name} &mdash; choose when it suits you, and we&rsquo;ll "
        "send a technician.</p>"
        f"{meta}{_error(location_error)}"
        f'<form method="post">{where}{groups}</form>'
        '<p class="note">Two-hour windows. Our technician will call before '
        "arriving.</p>",
        mark=mark,
        with_map=can_locate or located,
    )


@router.get("/slot/{token}", response_class=HTMLResponse, include_in_schema=False)
async def slot_page(token: str, db: Db) -> HTMLResponse:
    try:
        return await _render(db, token, just_confirmed=False)
    except Exception:  # noqa: BLE001 — a customer must never see a stack trace
        # The customer sees a plain page; the cause goes to the log, where a
        # swallowed error used to leave nothing at all.
        log.exception("slot page failed to render")
        return _closed(
            "Link not valid",
            "This scheduling link has expired or has already been used.",
        )


def _parse_point(lat: str | None, lng: str | None) -> tuple[float, float] | None:
    """`None` when the customer did not set one. Raises `AppError` when what
    they sent is not a usable point."""
    if not (lat or "").strip() and not (lng or "").strip():
        return None
    try:
        point = (float(lat or ""), float(lng or ""))
    except ValueError:
        raise AppError(
            status_code=400,
            code="LOCATION_UNREADABLE",
            detail="That location could not be read. Move the pin and try again.",
        ) from None
    validate_point(*point)
    return point


async def _save_location(
    db: AsyncSession, token: str, lat: str | None, lng: str | None
) -> str | None:
    """Save the customer's point. Returns a customer-facing message on a
    refusal, `None` on success or when there was nothing to save."""
    try:
        point = _parse_point(lat, lng)
        if point is None:
            return None
        row = await service.load_by_token(db, token)
        await service.save_customer_location(db, row, *point)
        await db.commit()
    except (AppError, HTTPException) as err:
        await db.rollback()
        return err.detail if isinstance(err.detail, str) else None
    return None


@router.post("/slot/{token}", response_class=HTMLResponse, include_in_schema=False)
async def choose_slot(
    token: str,
    db: Db,
    start: Annotated[str, Form()],
    lat: Annotated[str | None, Form()] = None,
    lng: Annotated[str | None, Form()] = None,
) -> HTMLResponse:
    try:
        chosen = datetime.datetime.fromisoformat(start)
    except ValueError:
        return _closed("Something went wrong", "Please open the link again.")

    # The location first, and never inside the time's transaction: a point that
    # cannot be saved must not lose the customer their time, and a technician who
    # accepts the moment the time lands must find the point already there.
    location_error = await _save_location(db, token, lat, lng)

    try:
        await service.confirm_slot(db, token, chosen)
    except Exception:  # noqa: BLE001
        # Most likely: somebody else confirmed it, or the window passed while
        # the page sat open. Re-render, which shows whichever is true.
        return await slot_page(token, db)

    return await _render(
        db, token, just_confirmed=True, location_error=location_error
    )


@router.post(
    "/slot/{token}/location", response_class=HTMLResponse, include_in_schema=False
)
async def choose_location(
    token: str,
    db: Db,
    lat: Annotated[str | None, Form()] = None,
    lng: Annotated[str | None, Form()] = None,
) -> HTMLResponse:
    """The location on its own: a ticket whose time is already fixed, or a
    customer coming back after picking a time without one."""
    try:
        message = await _save_location(db, token, lat, lng)
        return await _render(
            db, token, just_confirmed=False, location_error=message
        )
    except Exception:  # noqa: BLE001 — a customer must never see a stack trace
        return _closed(
            "Link not valid",
            "This scheduling link has expired or has already been used.",
        )
