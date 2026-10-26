"""The carve-out — F6 in one file.

When a franchisee takes pincodes, technicians who live entirely inside the
new set MOVE to it; technicians who straddle the boundary are TRIMMED (they
loose the inside codes and must keep at least one outside code — the profile
cannot go franchisee-less with zero routes). Unassigned open tickets on the
moved codes are re-stamped to the new owner; assigned tickets stay put.

Pure and stdlib-only (same rule as `pincode_ranges`): the service layer fetches
the coverage and owner maps, this module decides who moves, who is trimmed and
which tickets re-route, and the unit suite tests it with no database.
"""

import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field

from app.core.pincode_ranges import compress


@dataclass(frozen=True)
class CarvePlan:
    """Who takes inside codes from whom. `moved` is technician ids; `trimmed`
    maps a technician id to the codes it loses (never all of them)."""

    moved: frozenset[uuid.UUID] = frozenset()
    trimmed: Mapping[uuid.UUID, frozenset[str]] = field(default_factory=dict)

    @property
    def touched(self) -> frozenset[uuid.UUID]:
        return self.moved | frozenset(self.trimmed)


def plan_carve_out(
    codes: Iterable[str], coverage: Mapping[uuid.UUID, Iterable[str]]
) -> CarvePlan:
    """Partition the candidates. `coverage` maps a candidate's id (a technician
    NOT already running under the target — the caller filters that in SQL) to
    every code it currently covers. Fully inside the new set → moved; straddling
    → trimmed, losing only the inside codes and keeping the rest."""
    inside = set(codes)
    moved: set[uuid.UUID] = set()
    trimmed: dict[uuid.UUID, frozenset[str]] = {}
    for tech_id, cov in coverage.items():
        existing = frozenset(cov)
        if not inside or not existing:
            continue
        overlap = existing & inside
        if not overlap:
            continue
        if overlap >= existing:
            moved.add(tech_id)
        else:
            trimmed[tech_id] = overlap
    return CarvePlan(moved=frozenset(moved), trimmed=trimmed)


def diff_codes(
    current: Iterable[str], wanted: Iterable[str]
) -> tuple[frozenset[str], frozenset[str]]:
    """Wanted − current → (added, removed). Both empty → nothing to write."""
    cur, want = frozenset(current), frozenset(wanted)
    return want - cur, cur - want


def find_clashes(
    wanted: Iterable[str],
    owners: Mapping[str, uuid.UUID],
    target_id: uuid.UUID,
) -> dict[str, uuid.UUID]:
    """Which wanted codes somebody else already owns — pincode → its owner.
    The target's own codes are not clashes (idempotent saves stay no-ops)."""
    return {
        code: owners[code]
        for code in wanted
        if code in owners and owners[code] != target_id
    }


def clash_lines(
    clashes: Mapping[str, str], *, limit: int = 50
) -> list[str]:
    """Sorted `code — owner` lines for the errors array, capped at `limit`."""
    return [f"{code} — {clashes[code]}" for code in sorted(clashes)][:limit]


def clash_summary(
    clashes: Mapping[str, str], *, universe: Iterable[str] | None = None, limit: int = 5
) -> str:
    """One sentence for the 409 body: per owner (sorted by name), the codes it
    holds, compressed. `500120 (Acme Secunderabad); 500038-500040 (SkyFix)`."""
    if not clashes:
        return ""
    by_owner: dict[str, set[str]] = {}
    for code, name in clashes.items():
        by_owner.setdefault(name, set()).add(code)
    names = sorted(by_owner)
    visible, extra = names[:limit], names[limit:]
    parts = [
        f"{compress_codes(by_owner[n], universe)} ({n})" for n in visible
    ]
    if extra:
        parts.append(f"and {len(extra)} more franchisees")
    return "; ".join(parts)


def ticket_moves(
    rows: Iterable[tuple[uuid.UUID, str, uuid.UUID]],
    owner_after: Mapping[str, uuid.UUID],
) -> list[tuple[uuid.UUID, uuid.UUID, uuid.UUID]]:
    """Candidate ticket rows (id, pincode, current owner) → the ones to
    re-stamp: (ticket_id, from, to). A ticket whose pincode has no new owner,
    or whose owner is not changing, does not move."""
    moves: list[tuple[uuid.UUID, uuid.UUID, uuid.UUID]] = []
    for ticket_id, pincode, current in rows:
        target = owner_after.get(pincode)
        if target is not None and target != current:
            moves.append((ticket_id, current, target))
    return moves


def compress_codes(codes: Iterable[str], universe: Iterable[str] | None) -> str:
    """`pincode_ranges.compress` for the f-string in `clash_summary` to read
    cleanly at the call site."""
    return compress(codes, universe=universe)