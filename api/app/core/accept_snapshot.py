"""What depended on the technician when they took the job — the frozen terms.

Task 10. `tickets.accept_snapshot` (index §3.5) holds, per accepted job:

    { acceptedAt, technicianId, franchiseeId, technicianType, travel{...}, speed }

Written ONCE, by the guarded UPDATE that assigns the ticket — in
`jobs.service.accept` and `tickets.service.assign_technician` (W3) — and read
everywhere downstream through THIS module. A NULL snapshot means "accepted
before Task 10" and pays nothing; no reader here ever raises on it.

Split in two halves. The pure half is unit-tested with fakes
(`api/tests/unit/test_accept_snapshot.py`); the loader is a thin read of a
pincode's centre plus the franchisee's rule. Task 11 adds `speed` inside
`build_accept_snapshot` and re-types `speed_of` — the `speed: None` key is
written now so that extension is a one-function change.
"""

import datetime
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.travel import Point, compute_travel
from app.core.travel_rules import load_travel_rule
from app.models.technician import TECHNICIAN_TYPES
from app.models.territory import Pincode

# ── pure ─────────────────────────────────────────────────────────────────────


def customer_point(ticket_lat: float | None, ticket_lng: float | None,
                   pincode_lat: float | None, pincode_lng: float | None) -> Point | None:
    """TA2: the ticket's own map point, else its pincode's centre, else None."""
    if ticket_lat is not None and ticket_lng is not None:
        return Point(lat=ticket_lat, lng=ticket_lng, source="ticket")
    if pincode_lat is not None and pincode_lng is not None:
        return Point(lat=pincode_lat, lng=pincode_lng, source="pincode")
    return None


def base_point(technician) -> Point | None:
    """Duck-typed on base_latitude / base_longitude / base_source. None when unset."""
    lat = getattr(technician, "base_latitude", None)
    lng = getattr(technician, "base_longitude", None)
    source = getattr(technician, "base_source", None)
    if lat is None or lng is None or source is None:
        return None
    return Point(lat=lat, lng=lng, source=source)


def assemble(*, now: datetime.datetime, technician_id: uuid.UUID,
             franchisee_id: uuid.UUID, technician_type: str, travel: dict) -> dict:
    """The whole snapshot, index §3.5 keys; `speed` is None until Task 11.

    `acceptedAt` is UTC ISO-8601 with a trailing 'Z' — the shape the console's
    formatter and the app's both expect a wire timestamp to carry.
    """
    stamp = now.astimezone(datetime.timezone.utc).isoformat()
    return {
        "acceptedAt": stamp.replace("+00:00", "Z"),
        "technicianId": str(technician_id),
        "franchiseeId": str(franchisee_id),
        "technicianType": technician_type,
        "travel": travel,
        "speed": None,
    }


@dataclass(frozen=True)
class TravelView:
    technician_id: str | None
    amount_paise: int          # ≥ 0; 0 for anything unreadable
    max_paise_per_job: int     # ≥ 0
    km: float
    straight_km: float
    reason: str | None
    base_source: str | None
    customer_source: str | None
    raw: dict                  # the block as stored, for TicketTravelOut


def _int(value) -> int:
    """A non-negative real int (bools are NOT ints here) or 0. Never raises."""
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return 0
    return value


def _float(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _point_source(pt) -> str | None:
    if isinstance(pt, dict) and isinstance(pt.get("source"), str):
        return pt["source"]
    return None


def travel_of(snapshot: dict | None) -> TravelView | None:
    """None for a NULL snapshot, a non-dict, or a missing/non-dict `travel`.

    Non-int or negative money (bools included) reads as 0 — never raises. Old
    tickets have NO snapshot at all, and a partial one must not crash the read
    that is answering a question the writer never got to.
    """
    if not isinstance(snapshot, dict):
        return None
    travel = snapshot.get("travel")
    if not isinstance(travel, dict):
        return None
    base = travel.get("basePoint")
    customer = travel.get("customerPoint")
    return TravelView(
        technician_id=(
            str(snapshot.get("technicianId"))
            if isinstance(snapshot.get("technicianId"), (str, uuid.UUID))
            else None
        ),
        amount_paise=_int(travel.get("amountPaise")),
        max_paise_per_job=_int(travel.get("maxPaisePerJob")),
        km=_float(travel.get("km")),
        straight_km=_float(travel.get("straightKm")),
        reason=(
            travel.get("reason")
            if isinstance(travel.get("reason"), str)
            else None
        ),
        base_source=_point_source(base),
        customer_source=_point_source(customer),
        raw=travel,
    )


def speed_of(snapshot: dict | None) -> dict | None:
    """Placeholder: the `speed` dict or None, never raises. Task 11 (already
    written) replaces it with a typed `SpeedTerms | None` reader and fills
    `snapshot["speed"]` inside `build_accept_snapshot`. Task 10 keeps the
    `speed` key present and None, exactly as index §3.5, so that extension is
    a one-function change."""
    if not isinstance(snapshot, dict):
        return None
    speed = snapshot.get("speed")
    return speed if isinstance(speed, dict) else None


def technician_type_of(snapshot: dict | None, fallback: str) -> str:
    """The type frozen at accept (T1), else `fallback` (the live type)."""
    if isinstance(snapshot, dict):
        # The vocabulary is closed — an unknown value is unrecognised data, not
        # an instruction to pay differently.
        frozen = snapshot.get("technicianType")
        if isinstance(frozen, str) and frozen in TECHNICIAN_TYPES:
            return frozen
    return fallback


def closure_travel_paise(snapshot: dict | None, *, technician_id: uuid.UUID | None) -> int:
    """What customer closure pays: the frozen amount, iff the snapshot names
    this technician (W17); else 0."""
    if technician_id is None:
        return 0
    view = travel_of(snapshot)
    if view is None or view.technician_id != str(technician_id):
        return 0
    return view.amount_paise


def force_close_travel_paise(
    snapshot: dict | None, *, technician_id: uuid.UUID | None, requested: int | None
) -> int:
    """W5: None → 0; else min(requested, frozen maxPaisePerJob); 0 when the
    snapshot is missing or names somebody else.

    Bound by the frozen MAX, not the frozen amount (TA6): the amount was the
    estimate a full journey to the pincode would have paid, while a
    force-closure may be a part-done job the manager prices by judgement —
    capped as every other force-close field is.
    """
    if technician_id is None:
        return 0
    view = travel_of(snapshot)
    if view is None or view.technician_id != str(technician_id):
        return 0
    if requested is None or requested < 0:
        return 0
    return min(requested, view.max_paise_per_job)


# ── thin loader ──────────────────────────────────────────────────────────────


def _f(value) -> float | None:
    """Decimal → float, when a coordinate column is `numeric` (§3.0). None stays None."""
    return None if value is None else float(value)


async def build_accept_snapshot(
    db: AsyncSession, ticket, technician, now
) -> dict:
    """The snapshot `jobs.service.accept` and `tickets.service.assign_technician`
    write inside their guarded UPDATE (W3). Flushes nothing — a pure build."""
    rule = await load_travel_rule(
        db, company_id=ticket.company_id,
        franchisee_id=technician.franchisee_id,        # Task 01 column
        technician_type=technician.technician_type,    # Task 01 column
    )
    pin_lat = pin_lng = None
    if ticket.latitude is None:                         # only then is the pincode needed
        pin_lat, pin_lng = (await db.execute(
            select(Pincode.latitude, Pincode.longitude).where(Pincode.code == ticket.pincode)
        )).one_or_none() or (None, None)
    travel = compute_travel(
        base_point(technician),
        customer_point(ticket.latitude, ticket.longitude, _f(pin_lat), _f(pin_lng)),
        rule,
    )
    return assemble(now=now, technician_id=technician.id,
                    franchisee_id=technician.franchisee_id,
                    technician_type=technician.technician_type, travel=travel)


__all__ = [
    "TravelView",
    "assemble",
    "base_point",
    "build_accept_snapshot",
    "closure_travel_paise",
    "customer_point",
    "force_close_travel_paise",
    "speed_of",
    "technician_type_of",
    "travel_of",
]