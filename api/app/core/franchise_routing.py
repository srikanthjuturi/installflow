"""Pure decisions of franchise ticket routing — the stamp's arithmetic.

Core, not a slice, because jobs, tickets, realtime and the console sockets all
need these — api hard rule 4 (slices never import each other). Every function
here is pure: stdlib plus `uuid`, no database, no models — so they are
unit-testable with no service (`tests/unit/test_franchise_routing.py`,
`test_realtime_payloads.py`), per the X1 rule.

The database side of each stays beside its caller: the stamp is written by
`core.franchise.restamp_ticket`, the range refusals by
`core.franchise.assert_pincodes_in_franchisee`, and the SQL predicates by the
five eligibility places (index §5.5) in `jobs/service.py`, `core/coverage.py`
and `tickets/service.py` — that this file holds none of them is the point.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Mapping, Sequence
from typing import AbstractSet, Literal

#: How many of the offending codes `outside_message` names before it says "and N more".
#: A 422 with every code of a bad Excel sheet in it is an error message nobody reads.
OUTSIDE_MESSAGE_LIMIT = 20


def needs_restamp(current: uuid.UUID | None, owner: uuid.UUID) -> bool:
    """PURE. A ticket's stamp no longer matches its pincode's owner.

    `current is None` counts as needing one: a ticket without a stamp (a row
    written before Task 01's column had a value) is not a ticket that matches.
    """
    return current != owner


def codes_outside(
    wanted: Iterable[str], routes: Mapping[str, uuid.UUID], target: uuid.UUID
) -> list[str]:
    """PURE. The codes NOT routed to `target` — those of a coverage request that
    `assert_pincodes_in_franchisee` must refuse.

    Sorted and de-duplicated, so the message is stable no matter what order the
    form or the Excel sheet listed them in.
    """
    return sorted({p for p in wanted if routes.get(p) != target})


def outside_message(
    franchisee_name: str,
    outside: Sequence[str],
    *,
    owner_names: Mapping[str, str] | None,
    limit: int = OUTSIDE_MESSAGE_LIMIT,
) -> str:
    """PURE. The `PINCODE_OUTSIDE_FRANCHISEE` detail.

    With `owner_names` (staff caller): codes grouped by their owner, each group
    named — "Outside Acme Home: 500032, 500033 (SkyFix Services). Pick pincodes
    Acme Home owns." Staff may be told who owns what; that is how they fix it.

    Without (a franchise principal, or the technician at registration): one
    list, no other franchisee's name — "Outside your franchisee: 500032, 500033.
    Pick pincodes it owns." One franchisee's admin is not told who owns another
    franchisee's codes; the technician registering has nobody to ask yet.

    At most `limit` codes, then " and N more".
    """
    shown = list(outside)[:limit]
    extra = len(outside) - len(shown)
    if extra:  # rides in with the last code shown, wherever that lands in the grouping
        shown[-1] = f"{shown[-1]} and {extra} more" if shown else f"{extra} more"

    if owner_names is None:
        return f"Outside your franchisee: {', '.join(shown)}. Pick pincodes it owns."

    grouped: dict[str, list[str]] = {}
    for code in shown:
        grouped.setdefault(owner_names.get(code, "another franchisee"), []).append(code)
    parts = [
        ", ".join(codes) + (f" ({owner})" if owner != "another franchisee" else "")
        for owner, codes in grouped.items()
    ]
    return f"Outside {franchisee_name}: {', '.join(parts)}. Pick pincodes {franchisee_name} owns."


def accept_miss_reason(
    *, still_open: bool, same_franchisee: bool
) -> Literal["cap", "moved", "taken"]:
    """PURE. Why a guarded accept UPDATE matched no rows — the third case Task 04 adds.

    The row is unassigned and open, and the cap has room, but the technician's
    CURRENT franchisee no longer matches the ticket's: the job left this
    technician's pool, which is exactly what the pool read would now say —
    404 Job not found, never a misleading DAILY_CAP_REACHED.
    """
    if not still_open:
        return "taken"
    return "cap" if same_franchisee else "moved"


def pool_frame_matches(
    *,
    pincodes: AbstractSet[str],
    nodes: AbstractSet[uuid.UUID],
    franchisee_id: uuid.UUID | None,
    event_pincode: str,
    event_path: Sequence[uuid.UUID],
    event_franchisee: uuid.UUID | None,
) -> bool:
    """PURE. Does a `pool.changed` frame concern this technician?

    The coverage half is `jobs/ws.py`'s original test, unchanged: covering the
    pincode and certified anywhere on the job's path (an intersection, which is
    what makes certification descendant-aware). On top of it the franchisee
    half: the ticket's franchisee must be the technician's. Either side None —
    an old publisher, or a cache loaded before the socket — rings on the
    coverage test alone, because this socket is biased toward ringing too often
    rather than too rarely; a spurious ring costs one indexed query, a missed
    ring costs a technician the job.
    """
    if event_pincode not in pincodes or nodes.isdisjoint(event_path):
        return False
    return (
        event_franchisee is None
        or franchisee_id is None
        or event_franchisee == franchisee_id
    )


def franchise_hears_ticket(
    *,
    viewer_franchisee: uuid.UUID | None,
    facility: bool,
    event_franchisee: uuid.UUID | None,
) -> bool:
    """PURE. Should a franchise viewer's console ticket socket ring for this ticket?

    EXACT, not biased — the opposite trade-off of `pool_frame_matches`. A pool
    socket ringing spuriously costs the app one re-read of a list it already
    had; a ticket socket ringing for another franchisee's work is a console
    being *told* about a ticket it can read nothing of. So any doubt — either
    side unknown, or the viewer's facility branch still fail-closed (Task 12
    widens, as `service.scoped()` does) — is silence.
    """
    if facility or viewer_franchisee is None or event_franchisee is None:
        return False
    return viewer_franchisee == event_franchisee