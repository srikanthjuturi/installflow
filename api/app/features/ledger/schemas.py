"""The pool, and the entries that move it.

Paise on the wire, exactly as `tickets.bonusPaise` and unlike `settings/rules`,
which converts to rupees because a person types into that form. Nobody types
here: every figure is one this API computed, and converting it twice is how the
two surfaces end up disagreeing about a rounding.
"""

import datetime
import uuid

from app.core.schemas import AppModel


class LedgerPoolOut(AppModel):
    """§7's pool, as arithmetic rather than as three unrelated tiles.

    *"Penalties are collected into a pool used to fund reassignment bonuses"* —
    so `balancePaise` is not a stored figure but the difference of the two
    below it, computed on every read. A stored balance is a number that can
    disagree with the rows it claims to summarise, and eventually does.
    """

    #: Unspent penalty money — what a bonus is drawn against. **Can go
    #: negative**, and that is a real state worth seeing rather than clamping:
    #: it means the company has committed more in bonuses than its
    #: cancellations have funded, which is a decision somebody made and should
    #: be able to read back.
    balancePaise: int
    #: Positive. The debit sign belongs on the individual entry, not here.
    penaltiesCollectedPaise: int
    #: How many penalty entries, not how many tickets — a job cancelled twice
    #: collected twice.
    cancellations: int
    bonusesPaidPaise: int
    pickups: int


class LedgerEntryOut(AppModel):
    """One movement, from the pool's side of the transaction."""

    id: uuid.UUID
    at: datetime.datetime
    #: `penalty` | `bonus`. The console renders its own label and its own sign
    #: from this — see `models/ledger.py` on why no sign is stored.
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
