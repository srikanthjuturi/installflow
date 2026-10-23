"""How a technician is paid, and the questions every money writer asks first.

Task 06. A franchisee can employ a technician on a salary (`technician_type =
'employee'`). Three money paths then have to stop — the per-job `payout`
(T2), the UPI redemption (T4) — while everything else they earn or owe (a
cancellation penalty, an escalation bonus, later travel and speed money)
keeps flowing into the same ledger, and a monthly statement starts summarising
the employee stream for payroll.

`models/technician.py` names the two types; this is how the codebase asks
"What am I about to do to somebody of THIS type?" in one place, so the closure
path, the force-close path, the redemption path and the pool push cannot drift
into four different answers. Slices never import each other (hard rule 4),
which is why the helpers live here rather than in whichever of them needed the
answer first.

## An unreadable type pays, but does not redeem

`pays_per_job` returns True for `None` and for anything unrecognised, on
purpose. `None` is what a pre-Task-01 row reads as, and a reader that quietly
stopped paying an unfamiliar type would under-pay the one person the code
could not classify — the opposite direction to the one `may_redeem` errs in,
where refusing somebody whom no rule covers is the safe answer (an unknown
type cannot be claimed as salary either, but money that fails to move is a
bigger fact than money that waits).
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.accept_snapshot import technician_type_of
from app.models.technician import (
    TYPE_EMPLOYEE,
    TYPE_FREELANCER,
    TechnicianProfile,
)

#: The refusal Task 07's mobile screens read by `code` — the sentence under it
#: is Task 07's PROPOSED copy for the same code, kept beside the predicate so
#: the two cannot be shipped separately (§4.4).
_REDEEM_REFUSAL = (
    "EMPLOYEE_CANNOT_REDEEM",
    "Employees are paid through salary, so there is nothing to redeem.",
)


def pays_per_job(technician_type: str | None) -> bool:
    """T2: does this technician's NEXT closed job write a `payout` row?

    False for 'employee'; True for 'freelancer' AND for None/unknown — an
    unreadable type must not silently stop paying somebody, and None is what a
    pre-Task-01 row would read as.
    """
    return technician_type != TYPE_EMPLOYEE


def may_redeem(technician_type: str | None) -> bool:
    """T4: may this technician ask for money by UPI? False for 'employee' only."""
    return technician_type != TYPE_EMPLOYEE


def redeem_refusal(technician_type: str | None) -> tuple[str, str] | None:
    """(code, sentence) to refuse a redemption with, or None when it may go on.

    Only an employee is refused. The sentence is Task 07's PROPOSED copy for
    the same code.
    """
    if may_redeem(technician_type):
        return None
    return _REDEEM_REFUSAL


async def job_technician_type(
    db: AsyncSession, *, company_id: uuid.UUID, technician_id: uuid.UUID,
    snapshot: dict | None = None,
) -> str | None:
    """The type that governs per-job pay for a job this technician holds.

    Task 10 (T1): the type FROZEN at accept — `accept_snapshot.technicianType`
    — when the caller has one to hand (`snapshot=row.accept_snapshot`), so a
    type switch mid-job cannot restate what a job already settled: the payout
    and the pay channel are decided by the person who took the job, not the
    person who closes it. A `None`/pre-Task-10 snapshot keeps this function's
    original behaviour — the LIVE `TechnicianProfile.technician_type` — which
    is exactly right for a ticket taken before snapshots existed.

    `None` when `technician_id` is `None`, so every caller's `is not None`
    test stays the single guard it already is.
    """
    if technician_id is None:
        return None
    live = await db.scalar(
        select(TechnicianProfile.technician_type).where(
            TechnicianProfile.company_id == company_id,
            TechnicianProfile.id == technician_id,
        )
    )
    return technician_type_of(snapshot, fallback=live)


__all__ = [
    "TYPE_EMPLOYEE",
    "TYPE_FREELANCER",
    "job_technician_type",
    "may_redeem",
    "pays_per_job",
    "redeem_refusal",
]