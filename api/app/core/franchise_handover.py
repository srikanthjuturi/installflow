"""Pure decisions of handing an unassigned ticket to another franchisee (Task 18).

Core, not a slice (api hard rule 4), and PURE: stdlib plus `uuid`, no database, no
models - so every rule here is unit-tested with no service
(`tests/unit/test_franchise_handover.py`, X1). The database side of each stays beside
its caller: `tickets.service.hand_to_franchisee` writes, `core.coverage` holds the SQL
predicates these functions are the twins of.

## The idea (H1)

A ticket belongs to the franchisee that owns its pincode - and only that franchisee's
technicians cover the pincode, because a technician's coverage must lie inside their
own franchisee's range. A person who hands the ticket to ANOTHER franchisee therefore
has to waive the pincode half of eligibility for that ticket, and ONLY that half:

    eligible  <=>  technician.franchisee_id == ticket.franchisee_id            (never waived)
              and  (covers the pincode  OR  ticket.routing_override)           (the waiver)
              and  certified, ACTIVE, room on the day, ...                     (never waived)

`routing_override` is DERIVED here (`override_for`), never typed by a client.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping, Sequence
from typing import Any, Literal

#: The only statuses a ticket may be handed over from - F6's re-stamp set. A ticket with a
#: technician is refused whatever its status (H3).
HANDOVER_STATUSES = ("New", "Slot Pending", "Escalated")

#: Nothing can be done to these any more.
TERMINAL = ("Closed", "Force-Closed", "Cancelled")

Blocker = Literal[
    "TICKET_NOT_ASSIGNABLE", "TICKET_ASSIGNED", "SAME_FRANCHISEE", "FRANCHISEE_INACTIVE"
]

#: The longest reason the API accepts (the bound `RescheduleRequest.reason` already uses).
REASON_MIN = 3
REASON_MAX = 255


def handover_blocker(
    *,
    status: str,
    has_technician: bool,
    current: uuid.UUID,
    target: uuid.UUID | None,
    target_active: bool = True,
) -> Blocker | None:
    """PURE. Why this ticket cannot be handed to `target`, or None.

    Order is part of the contract and pinned by tests: terminal, then
    assigned/live, then same franchisee, then inactive target. `target=None` is the
    options call, which has no target yet: only the ticket-side blockers apply.
    """
    if status in TERMINAL:
        return "TICKET_NOT_ASSIGNABLE"
    if has_technician or status not in HANDOVER_STATUSES:
        return "TICKET_ASSIGNED"
    if target is None:
        return None
    if target == current:
        return "SAME_FRANCHISEE"
    if not target_active:
        return "FRANCHISEE_INACTIVE"
    return None


def blocker_message(
    blocker: Blocker, *, code: str, status: str, franchisee_name: str
) -> str:
    """PURE. The sentence a refusal carries (PROPOSED copy, doc 18 §4.6). `franchisee_name` is the
    TARGET's for `FRANCHISEE_INACTIVE` and the ticket's current one for `SAME_FRANCHISEE`."""
    if blocker == "TICKET_ASSIGNED":
        return (
            f"{code} already has a technician, so it can't move to another franchisee. "
            "Cancel it from the technician first, or re-assign it."
        )
    if blocker == "TICKET_NOT_ASSIGNABLE":
        return f"This ticket is {status} and can no longer be moved."
    if blocker == "SAME_FRANCHISEE":
        return f"{code} already belongs to {franchisee_name}. Choose a different franchisee."
    return f"{franchisee_name} is switched off and can't be given work. Choose another franchisee."


def override_for(*, target: uuid.UUID, owner: uuid.UUID) -> bool:
    """PURE. The derived `routing_override`: a person chose a franchisee that is not
    the pincode's owner. Handing a ticket back to the owner clears it."""
    return target != owner


def coverage_required(*, franchisee_id: uuid.UUID, owner_id: uuid.UUID) -> bool:
    """PURE. Is the pincode half still required for this franchisee's technicians when a
    ticket is (hypothetically) handed to it? Only for the pincode's own owner.

    The twin of `core.coverage.technicians_by_franchisee`'s SQL clause
    (`franchisee_id != owner OR covers_pincode`), pinned by tests so the two cannot drift.
    """
    return franchisee_id == owner_id


def covers_ok(*, covers: bool, routing_override: bool) -> bool:
    """PURE. The coverage test of all five eligibility places: covers the pincode OR the
    ticket was handed over. Never touches the franchisee or certification tests."""
    return covers or routing_override


def status_after(was: str, *, offerable: bool, has_slot: bool) -> str:
    """PURE. The status a hand-over leaves: `New`/`Slot Pending` keep theirs; an
    `Escalated` ticket goes back to the pool (`New` with a slot, `Slot Pending`
    without) only if the pool can still offer it - the same exit a bonus gives it (H4).
    An escalated ticket whose window has closed stays `Escalated`."""
    if was != "Escalated" or not offerable:
        return was
    return "New" if has_slot else "Slot Pending"


def _one_line(text: str) -> str:
    return " ".join(text.split())


def handover_note(from_name: str, to_name: str, reason: str, *, back_in_pool: bool) -> str:
    """PURE. The timeline note: `{from} -> {to} · handed over: {reason}` plus
    ` · back in the pool` when an escalated ticket left the queue. The reason is collapsed to
    one line; names are never truncated."""
    note = f"{from_name} → {to_name} · handed over: {_one_line(reason)}"
    return note + " · back in the pool" if back_in_pool else note


def option_order(options: Sequence[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    """PURE. The picker's order: eligible technicians desc, online desc, then name
    case-insensitively. `sorted` is stable, so equal keys keep their input order."""
    return sorted(
        options,
        key=lambda o: (
            -int(o.get("eligibleTechnicians", 0)),
            -int(o.get("onlineTechnicians", 0)),
            str(o.get("name", "")).lower(),
        ),
    )
