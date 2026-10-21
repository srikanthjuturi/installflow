"""The pool, and the entries that move it.

Paise on the wire, exactly as `tickets.bonusPaise` and unlike `settings/rules`,
which converts to rupees because a person types into that form. Nobody types
here: every figure is one this API computed, and converting it twice is how the
two surfaces end up disagreeing about a rounding.
"""

import datetime
import typing as t
import uuid

from pydantic import Field

from app.core.schemas import AppModel


class LedgerPoolOut(AppModel):
    """§7's pool, as arithmetic rather than as three unrelated tiles.

    *"Penalties are collected into a pool used to fund reassignment bonuses"* —
    so `balancePaise` is not a stored figure but the difference of the two
    below it, computed on every read. A stored balance is a number that can
    disagree with the rows it claims to summarise, and eventually does.

    There is one pool PER FRANCHISEE (F12) since Task 05, so the answer names
    which one it is.
    """

    #: Unspent penalty money — what a bonus is drawn against. **Can go
    #: negative**, and that is a real state worth seeing rather than clamping:
    #: it means the company has committed more in bonuses than its
    #: cancellations have funded, which is a decision somebody made and should
    #: be able to read back.
    balancePaise: int
    #: Positive. The debit sign belongs on the individual entry, not here.
    #: NET of reversals — a penalty a manager gave back was never really
    #: collected, and `balance = collected − bonuses` has to keep holding.
    penaltiesCollectedPaise: int
    #: How many penalty entries still stand, not how many tickets — a job
    #: cancelled twice collected twice; a reversed penalty no longer counts.
    cancellations: int
    bonusesPaidPaise: int
    pickups: int
    #: Whose pool this is (Task 05 §4.12) — every money read names its
    #: franchisee.
    franchiseeId: uuid.UUID
    franchiseeName: str


class LedgerEntryOut(AppModel):
    """One movement, from the pool's side of the transaction."""

    id: uuid.UUID
    at: datetime.datetime
    #: `penalty` | `bonus` | `reversal`. The console renders its own label and
    #: its own sign from this — see `models/ledger.py` on why no sign is stored.
    #: A `reversal` is a penalty given back: the technician's `+`, the pool's out.
    kind: str
    #: PAISE, always positive. `kind` carries the direction.
    amountPaise: int
    technicianId: uuid.UUID
    technicianName: str
    ticketId: uuid.UUID
    #: `INST-240912` — what a person quotes, not the UUID beside it.
    ticketCode: str
    #: What it was for, as recorded at the time. Never re-derived: the band
    #: labels and the amounts can both be changed by a ruling or a company, and
    #: a record of money says what was true when it moved.
    reason: str
    #: On a `penalty`: whether a manager has since given it back. The penalty
    #: row itself never changes — the `reversal` row is the record — so this is
    #: read off that row, for the tag the console draws beside the charge.
    #: Always false on the other kinds.
    reversed: bool = False
    #: The pool the money belongs to, and the stream it came from — stamped on
    #: every row since Task 05 (F12, §3.3), read straight off the entry.
    franchiseeId: uuid.UUID
    technicianType: t.Literal["employee", "freelancer"]


class ReverseRequest(AppModel):
    """Giving a penalty back, for a reason the technician and any reader sees.

    The same shape both doors ask for — `§4.10`'s ticket route and this
    franchisee's own Pool door — because it is one body around one act
    (`core.penalty_reversal`). Rule 4 duplicates it here rather than having a
    feature import a feature.
    """

    reason: str = Field(min_length=3, max_length=160)
