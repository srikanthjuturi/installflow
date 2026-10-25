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

from app.core.speed import SpeedTerms
from app.core.speed_rules import resolve_terms
from app.core.travel import Point, compute_travel
from app.core.travel_rules import load_travel_rule
from app.models.franchisee_speed_rule import SPEED_HOURS, SPEED_PAISE
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
             franchisee_id: uuid.UUID, technician_type: str, travel: dict,
             speed: dict | None) -> dict:
    """The whole snapshot, index §3.5 keys; `speed` is the terms frozen here
    (S5, Task 11) or None when no rule applied — W1 keeps an empty matrix
    stamping None, exactly as Task 10 wrote until Task 11 filled this in.

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
        "speed": speed,
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


def speed_of(snapshot: dict | None) -> SpeedTerms | None:
    """The speed terms frozen at accept, or None — never raises.

    The `snapshot_value` rule: None for a NULL snapshot, a non-dict `speed`,
    a missing key, or ANY key missing or ill-typed — a hand-patched snapshot
    must not 500 the read answering a question the writer never got to. The
    vocabulary of `matchedOn` is closed (an unknown literal is unrecognised
    data, never a resolution); the money and hours are typed strictly with
    the same non-negative-int reader `travel_of` uses, so a bool or a string
    reads as "no terms at all" rather than as 0.

    `speed_settle.settle_speed` reads this, as do the ticket detail's `speed`
    block and `JobOut.speed` — nobody reads `accept_snapshot["speed"][…]`
    directly (Task 11 §8's trap).
    """
    speed = snapshot.get("speed") if isinstance(snapshot, dict) else None
    if not isinstance(speed, dict):
        return None

    matched_on = speed.get("matchedOn")
    if matched_on not in ("model", "node"):
        return None

    def _ids(key: str) -> uuid.UUID | None:
        try:
            return uuid.UUID(speed.get(key))
        except (TypeError, ValueError, AttributeError):
            return None

    matched_id = _ids("matchedId")
    rule_id = _ids("ruleId")   # None when absent, null or unparseable
    hours = [speed.get(k) for k in
             ("rewardWithinHours", "penaltyAfterHours")]
    money = [speed.get(k) for k in ("rewardPaise", "penaltyPaise")]
    if not _positive_hours(*hours) or not _non_negative(*money) or matched_id is None:
        return None
    return SpeedTerms(
        rule_id=rule_id,
        matched_on=matched_on,
        matched_id=matched_id,
        reward_within_hours=hours[0],
        penalty_after_hours=hours[1],
        reward_paise=money[0],
        penalty_paise=money[1],
    )


def _positive_hours(*values) -> bool:
    """1–720, ints (bools are NOT ints), no bools — the matrix's own W3."""
    return all(
        isinstance(v, int)
        and not isinstance(v, bool)
        and SPEED_HOURS[0] <= v <= SPEED_HOURS[1]
        for v in values
    )


def _non_negative(*values) -> bool:
    """0–1,000,000, ints (bools are NOT ints) — the matrix's own W3."""
    return all(
        isinstance(v, int)
        and not isinstance(v, bool)
        and SPEED_PAISE[0] <= v <= SPEED_PAISE[1]
        for v in values
    )


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
    write inside their guarded UPDATE (W3). Flushes nothing — a pure build
    (the resolutions inside it only read)."""
    rule = await load_travel_rule(
        db, company_id=ticket.company_id,
        franchisee_id=technician.franchisee_id,        # Task 01 column
        technician_type=technician.technician_type,    # Task 01 column
    )
    # Task 11 (S5): the speed terms freeze HERE, at accept, from the payer's
    # own matrix — a rule edited later restates nothing already stamped, and
    # the closure is judged on these four figures for as long as the job is
    # this technician's. No rows exist (W1, an empty matrix) → None, and
    # nothing at closure is ever measured. Resolution keys on the technician's
    # franchisee and type as frozen per T1.
    terms = await resolve_terms(
        db, company_id=ticket.company_id,
        franchisee_id=technician.franchisee_id,
        technician_type=technician.technician_type,
        model_id=ticket.model_id, node_path_ids=ticket.node_path_ids,
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
    return assemble(
        now=now, technician_id=technician.id,
        franchisee_id=technician.franchisee_id,
        technician_type=technician.technician_type,
        travel=travel,
        speed=(
            None if terms is None else {
                "ruleId": str(terms.rule_id), "matchedOn": terms.matched_on,
                "matchedId": str(terms.matched_id),
                "rewardWithinHours": terms.reward_within_hours,
                "penaltyAfterHours": terms.penalty_after_hours,
                "rewardPaise": terms.reward_paise,
                "penaltyPaise": terms.penalty_paise,
            }
        ),
    )


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