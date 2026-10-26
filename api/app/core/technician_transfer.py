"""Moving a technician between franchisees — the pure decisions (Task 17).

Core, not a slice, and PURE (Task 00 §4.1): stdlib, `uuid` and two other pure
core modules — no database, no models, no session — so every sentence and every
rule below is unit-tested with no service (`tests/unit/test_technician_transfer.py`).
The database half lives in `features/technicians/transfer_service.py`, which
reads the facts and calls these.

## What a transfer is

A company Admin or National Head changes WHO RUNS a technician from now on —
their pool, their payer, their pincodes — and nothing about what already
happened (D2, §4.6): every ledger row, redemption and ticket keeps the
franchisee it was earned under. That is why the blockers below are exactly the
ones a type change has (R5): with no open job and no redeemable money, nothing
but a reversal can write a row against the technician, so no money can be
half-written across the move.

## Coverage

`plan_coverage` is the single-person sibling of Task 03's carve-out planner:
keep what is inside the target's range, report what is taken off, and refuse an
empty result (F6) — a technician with no coverage is matched by nothing and
vanishes silently, the failure Task 04 exists to refuse.

## Wording

Every refusal sentence the console shows is built here, once, so the API and
the preview say the same thing. The notices carry no product name (white-label,
root AGENTS.md): they name the franchisee and the technician only.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import AbstractSet, Literal

from app.core.money import rupees

CODE_OPEN_JOBS = "TECHNICIAN_HAS_OPEN_JOBS"
CODE_BALANCE = "TECHNICIAN_HAS_BALANCE"
CODE_NO_ADMIN = "FRANCHISEE_HAS_NO_ADMIN"
CODE_OUTSIDE = "PINCODE_OUTSIDE_FRANCHISEE"
NOTIFICATION_KIND = "technician_moved"  # 16 chars; notifications.kind is String(24)
MIN_REASON = 5
MAX_REASON = 255

#: The bell's column limits (`notifications.title` / `detail`).
TITLE_LIMIT = 160
DETAIL_LIMIT = 255


@dataclass(frozen=True)
class Blocker:
    """One thing standing in the way. `code is None` is a code-less 409 ("already
    works for…", "inactive") — the client shows the sentence and nothing else."""

    code: str | None
    message: str
    open_jobs: int | None = None
    redeemable_paise: int | None = None
    redemption_code: str | None = None


@dataclass(frozen=True)
class CoveragePlan:
    source: Literal["kept", "supplied"]
    kept: tuple[str, ...]  # in current AND in final
    trimmed: tuple[str, ...]  # in current, not in final
    added: tuple[str, ...]  # in final, not in current
    final: tuple[str, ...]  # sorted, de-duplicated
    outside: tuple[str, ...]  # supplied codes the target does not own (sorted)
    nothing_left: bool  # final is empty

    @property
    def changed(self) -> bool:
        """Does the stored coverage differ from `final`?"""
        return bool(self.trimmed or self.added)


# ── the reason ───────────────────────────────────────────────────────────────


def reason_problem(text: str | None, *, name: str | None = None) -> str | None:
    """None when fine. Strips; under 5 characters -> a sentence naming who is
    being moved (the service passes the name; `this technician` otherwise); over
    255 -> a second sentence."""
    stripped = (text or "").strip()
    if len(stripped) < MIN_REASON:
        who = name or "this technician"
        return f"Say why {who} is being moved (at least {MIN_REASON} characters)"
    if len(stripped) > MAX_REASON:
        return f"Keep the reason under {MAX_REASON} characters"
    return None


# ── coverage ─────────────────────────────────────────────────────────────────


def plan_coverage(
    current: Iterable[str],
    routes: Mapping[str, uuid.UUID],
    target: uuid.UUID,
    supplied: Sequence[str] | None,
) -> CoveragePlan:
    """What the technician's pincodes become.

    `supplied is None` -> final = {c in current : routes[c] == target}; source
    `'kept'`. `supplied` given -> final = sorted(set(supplied)); outside = the
    codes of final the target does not own; source `'supplied'`. A code missing
    from `routes` counts as outside (fail closed). The home is no special case:
    its `routes` entry is simply the code nobody else owns (F4).
    """
    before = set(current)
    if supplied is None:
        final = {c for c in before if routes.get(c) == target}
        outside: tuple[str, ...] = ()
        source: Literal["kept", "supplied"] = "kept"
    else:
        final = set(supplied)
        outside = tuple(sorted(c for c in final if routes.get(c) != target))
        source = "supplied"
    return CoveragePlan(
        source=source,
        kept=tuple(sorted(final & before)),
        trimmed=tuple(sorted(before - final)),
        added=tuple(sorted(final - before)),
        final=tuple(sorted(final)),
        outside=outside,
        nothing_left=not final,
    )


def coverage_diff(
    before: Iterable[str], after: Iterable[str]
) -> tuple[list[str], list[str], list[str]]:
    """`(kept, trimmed, added)` of a recorded move, from its two stored arrays —
    the history rows derive these rather than storing them twice."""
    b, a = set(before), set(after)
    return sorted(b & a), sorted(b - a), sorted(a - b)


def single_region(regions: AbstractSet[uuid.UUID]) -> uuid.UUID | None:
    """Exactly one region -> it; none -> None. More than one -> ValueError (the
    service turns that into the 422): a technician works in one region (D5)."""
    if len(regions) > 1:
        raise ValueError("coverage spans more than one region")
    return next(iter(regions), None)


def multi_region_message(names: Iterable[str]) -> str:
    return (
        f"Those pincodes are in more than one region ({', '.join(sorted(names))}). "
        "A technician works in one region — pick pincodes from one."
    )


# ── refusals ─────────────────────────────────────────────────────────────────


def _jobs_sentence(code: str, open_jobs: int) -> str:
    if open_jobs == 1:
        return f"{code} still has 1 open job. Finish or reassign it first."
    return f"{code} still has {open_jobs} open jobs. Finish or reassign them first."


def transfer_blockers(
    *,
    same_franchisee: bool,
    target_name: str,
    target_active: bool,
    target_is_home: bool,
    target_active_admins: int,
    technician_code: str,
    open_jobs: int,
    redeemable_paise: int,
    open_redemption_code: str | None,
    plan: CoveragePlan,
    technician_name: str | None = None,
    outside_text: str | None = None,
) -> list[Blocker]:
    """Everything in the way, in a stable order: same franchisee -> target
    inactive -> target has no admin -> open jobs -> balance / open redemption ->
    coverage (outside, or nothing left). The service raises the FIRST on apply
    and returns ALL on a dry run.

    A NEGATIVE balance is not a blocker (D7) — `transfer_warnings` says it.
    `technician_name` falls back to the code; `outside_text` is the staff
    variant of the out-of-range sentence the service builds with the owners'
    names (`franchise_routing.outside_message`), used verbatim when given.
    """
    name = technician_name or technician_code
    if same_franchisee:
        return [Blocker(None, f"{name} already works for {target_name}.")]

    out: list[Blocker] = []
    if not target_active:
        out.append(Blocker(None, f"Activate {target_name} before moving technicians to it."))
    if not target_is_home and target_active_admins <= 0:
        out.append(
            Blocker(
                CODE_NO_ADMIN,
                f"{target_name} has no active admin yet. Add one first, or nobody can "
                f"approve {name}'s UPI changes or pay their redemptions.",
            )
        )
    if open_jobs > 0:
        out.append(
            Blocker(CODE_OPEN_JOBS, _jobs_sentence(technician_code, open_jobs), open_jobs=open_jobs)
        )
    if redeemable_paise > 0:
        out.append(
            Blocker(
                CODE_BALANCE,
                f"{name} still has {rupees(redeemable_paise)} waiting to be redeemed. "
                "Let them redeem it and be paid, then move them.",
                redeemable_paise=redeemable_paise,
            )
        )
    if open_redemption_code:
        out.append(
            Blocker(
                CODE_BALANCE,
                f"{name} has a redemption ({open_redemption_code}) that has not been "
                "settled. Settle it first.",
                redemption_code=open_redemption_code,
            )
        )
    if plan.outside:
        out.append(
            Blocker(
                CODE_OUTSIDE,
                outside_text
                or f"Not in {target_name}'s area: {', '.join(plan.outside)}. "
                f"Pick pincodes {target_name} owns.",
            )
        )
    elif plan.nothing_left:
        out.append(
            Blocker(
                CODE_OUTSIDE,
                f"None of {technician_code}'s pincodes is inside {target_name}'s area. "
                f"Choose the pincodes {target_name} should serve.",
            )
        )
    return out


def transfer_warnings(
    *,
    technician_name: str,
    target_name: str,
    redeemable_paise: int,
    pending_upi_change: bool,
    base_pincode_outside: bool,
    base_pincode: str | None,
) -> list[str]:
    """Non-blocking things to read before pressing Move: a negative balance, a
    pending UPI change that travels with them, a base set from a pincode the
    new area does not own."""
    out: list[str] = []
    if redeemable_paise < 0:
        out.append(
            f"{technician_name} owes {rupees(-redeemable_paise)} from earlier penalties. "
            f"It stays in their balance and comes off their next payouts, which {target_name} will pay."
        )
    if pending_upi_change:
        out.append(
            f"A UPI change is waiting. It moves with them, and {target_name}'s reviewer is asked."
        )
    if base_pincode_outside and base_pincode:
        out.append(
            f"Their base location was set from pincode {base_pincode}, outside "
            f"{target_name}'s area. It is kept as it is."
        )
    return out


# ── the bells ────────────────────────────────────────────────────────────────


def _clip(text: str, limit: int) -> str:
    """Cut with an ellipsis so the result is at most `limit` characters."""
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


def transfer_notices(
    *,
    technician_name: str,
    technician_code: str,
    from_name: str,
    to_name: str,
    reason: str,
) -> tuple[tuple[str, str], tuple[str, str]]:
    """`((joining_title, joining_detail), (leaving_title, leaving_detail))`.

    Titles <= 160, details <= 255 (the reason is the part cut, with an ellipsis).
    No product name: they say who moved and between which franchisees, nothing
    about whose platform this is.
    """
    prefix = f"{technician_code} · from {from_name} · "
    detail = prefix + _clip(reason.strip(), max(1, DETAIL_LIMIT - len(prefix)))
    detail = _clip(detail, DETAIL_LIMIT)  # a franchisee name long enough to eat the reason
    joining = _clip(f"{technician_name} joined {to_name}", TITLE_LIMIT)
    leaving = _clip(f"{technician_name} moved to {to_name}", TITLE_LIMIT)
    return (joining, detail), (leaving, detail)
