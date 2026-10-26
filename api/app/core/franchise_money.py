""""May this caller see / act on this franchisee's money" — F7/F8/F12 in one file.

Named wrappers over `core.franchise_scope`'s pure matrix, because the money
rule has one place to read and one source of truth (Task 05 §4.3; Task 11
§4.11 reuses these). The wrappers are thin on purpose: the matrix itself is
unit-tested in `core.franchise_scope`'s own tests, and these add only the
vocabulary — WHICH purpose answers WHICH money question — so a caller does not
have to re-derive that `REVERSE` is the purpose that happens to grant
company Admin/NH their read-only views:

    | role                        | may see / reverse   |
    | admin, national_head        | every franchisee    |
    | regional_head, area_manager | home only           |
    | franchisee_admin            | own only            |
    | facility, technician, vendor| nothing             |

A caller that refuses here picks its own status: something the caller can SEE
is 403, something it cannot see is 404 via a company-scoped loader — the same
ANDing-with-the-endpoint principle `franchise_scope` documents. None of this
replaces territory (`technician_scope`) or an AM floor; it is the franchisee
wall, the one question the pincodes cannot answer.

`pool_franchisee` is the read-side twin: which pool a read is ABOUT — the
parameter `core.ledger.pool` now requires — resolved from the caller instead of
guessed, the way the tenancy rule wants (a guessed id becomes 404, never 403).
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.franchise import home_franchisee_id
from app.core.franchise_scope import (
    REVERSE,
    decide_can_manage,
    decide_managed_franchisees,
)
from app.models.franchisee import Franchisee
from app.models.technician import TYPE_EMPLOYEE, TYPE_FREELANCER


def may_see_money(
    *,
    role: str,
    principal_franchisee_id: uuid.UUID | None,
    money_franchisee_id: uuid.UUID,
    home_id: uuid.UUID,
) -> bool:
    """May this caller SEE this franchisee's money (pool, ledger, redemptions)?

    `decide_can_manage(decide_managed_franchisees(..., purpose=REVERSE), ...)`.
    F8 grants company Admin/NH "penalty reversal and read-only views" on the
    same footing, and an AM "cannot see SkyFix's money" — exactly the REVERSE
    column of Task 02's matrix. So: admin/NH → any; RH/AM → home only;
    franchisee admin → own; everyone else → False.
    """
    return decide_can_manage(
        decide_managed_franchisees(
            role=role,
            principal_franchisee_id=principal_franchisee_id,
            home_id=home_id,
            purpose=REVERSE,
        ),
        money_franchisee_id,
    )


def may_reverse(
    *,
    role: str,
    principal_franchisee_id: uuid.UUID | None,
    penalty_franchisee_id: uuid.UUID,
    home_id: uuid.UUID,
) -> bool:
    """May this caller GIVE BACK a penalty of this franchisee?

    The same expression — that is the point of the REVERSE column; the two
    questions never disagree. (Territory is `_load`'s job on Door 1, exactly as
    today: an AM reversing a home penalty still has to hold the ticket's
    area.)
    """
    return decide_can_manage(
        decide_managed_franchisees(
            role=role,
            principal_franchisee_id=principal_franchisee_id,
            home_id=home_id,
            purpose=REVERSE,
        ),
        penalty_franchisee_id,
    )


def pool_franchisee(
    *,
    is_franchise: bool,
    own: uuid.UUID | None,
    requested: uuid.UUID | None,
    home_id: uuid.UUID,
    known: set[uuid.UUID],
) -> uuid.UUID | None:
    """Which pool a read is about — None means "nobody's", i.e. a 404 for the
    caller (`core.ledger.pool` requires an id; a guessed id → 404, not 403).

    A franchise principal reads their OWN pool and nothing else, so a
    foreign `requested` id on `GET /franchise/ledger/pool?franchiseeId=…` is
    ignored — the franchise wall is structural there, not a check (Task 02's
    `require_franchise_principal` has already pinned the caller). Staff:
    `requested` when it is one of THIS company's non-deleted franchisees
    (`known`, one query via `money_context`), home when it is absent. Unknown →
    None, so the reader hears "Franchisee not found" rather than somebody
    else's numbers.
    """
    if is_franchise:
        return own
    if requested is None:
        return home_id
    return requested if requested in known else None


def redemption_audience(*, is_home: bool) -> str:
    """Whose bell a redemption rings (Task 05 §4.7).

    Home → `payers`, today's company payer unchanged (F8). Non-home →
    `franchisee_admin` — the redemption is that franchisee's money, the
    company payer must never pay it (owner ruling R3), and the row's
    `franchisee_id` says which of them the bell is.
    """
    return "payers" if is_home else "franchisee_admin"


def type_change_refusal(
    *,
    old: str,
    new: str,
    open_jobs: int,
    freelancer_balance_paise: int,
) -> tuple[str, str] | None:
    """Why a technician type change is refused, or None when it may go ahead.

    Owner ruling 2026-10-15 (R5): the change is refused while the technician
    holds an open job — it makes "type now" and "type at accept" (T1) the same
    fact for every row Tasks 05/06 write before Task 10's `accept_snapshot`, and
    "type at accept" is the fact the money stream is stamped with.

    Task 06 extends the ruling with the balance, in the order the owner set:
    open jobs FIRST, then the freelancer→employee balance clause. The balance
    is the redeemable one (`core.ledger.redeemable_balance` — freelancer
    stream less every redemption not declined), because employee money is
    salary money and cannot be redeemed; a freelancer with ₹3,200 they have not
    taken out would otherwise have that money frozen on switching — employees
    cannot redeem (T4) and no month boundary can express paying it through
    salary. So the change waits: redeem it (or pay it), then switch.

    Deliberately NOT refused:

    * **A NEGATIVE balance** — penalties exceeded what they earned. The debt
      stays in the freelancer stream, is not deducted from salary, and offsets
      their next payouts if they return to freelancing.
    * **An open redemption** does not block: it is already reserved, so the
      balance is ≤ 0, and it stays payable and confirmable after the switch.
    * **The employee→freelancer direction** — the open-jobs guard is the whole
      answer. Old employee-era rows are never redeemable, so nothing pays out
      twice when the freelancer stream resumes.
    """
    if old == new:
        return None
    if open_jobs > 0:
        return (
            "TECHNICIAN_HAS_OPEN_JOBS",
            f"{open_jobs} open job(s). Finish or reassign them before "
            "changing the type.",
        )
    if (
        old == TYPE_FREELANCER
        and new == TYPE_EMPLOYEE
        and freelancer_balance_paise > 0
    ):
        rupees = f"₹{freelancer_balance_paise // 100:,}"
        pennies = freelancer_balance_paise % 100
        if pennies:
            rupees += f".{pennies:02d}"
        return (
            "TECHNICIAN_HAS_BALANCE",
            f"{rupees} is still waiting to be redeemed. Ask them to redeem it "
            "(or pay it), then change the type.",
        )
    return None


async def money_context(
    db: AsyncSession, company_id: uuid.UUID
) -> tuple[uuid.UUID, set[uuid.UUID]]:
    """The home id, and the company's franchisee ids — one query.

    Everything §4 needs before a money read: `home_id` for the REVERSE matrix
    and the pool Franchisee column, `known` for `pool_franchisee` to answer
    "is a requested franchiseeId somebody we serve". Non-deleted ones only — a
    soft-deleted franchisee's history still exists but reads of it are a
    question for the screens that carry history, not for a pool picker.
    """
    rows = await db.execute(
        select(Franchisee.id, Franchisee.is_home).where(
            Franchisee.company_id == company_id,
            Franchisee.deleted_at.is_(None),
        )
    )
    franchisee_ids = {row.id for row in rows}
    home_id = next(
        (row.id for row in rows if row.is_home),
        None,
    )
    if home_id is None:
        # Every company got a home in `3b7e1f0a9c41`; this heals a company
        # created before the migration ran, exactly as `home_franchisee_id`
        # does for its other callers.
        home_id = await home_franchisee_id(db, company_id)
    return home_id, franchisee_ids