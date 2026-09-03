"""The penalty pool — money out of a technician, money back to one.

§7 makes these two movements one fact, and the console's own note puts it
best: *"Cancellation penalties are collected INTO a pool, and that same pool is
what FUNDS the bonus paid to whoever picks up an escalated ticket. Money in
equals money out."* One table, therefore, rather than a penalties table and a
bonuses table that would have to be summed together to answer the only
question anybody asks of them:

    balance = SUM(penalty) - SUM(bonus)

## The third kind is not part of that sum

`payout` — what a technician earned for finishing a job — lives in this same
table because it is money moving to the same person, about the same ticket, and
the technician's Earnings screen reads all three as one list. It is deliberately
NOT in the balance above: the pool is a closed circuit funded by cancellations,
while a payout is the company paying for work from outside it. Adding payouts to
`balance` would report the pool as massively overdrawn and stop the bonus screen
from ever offering one.

Everything that reads the pool names its kinds explicitly rather than summing
the table — see `POOL_KINDS` below.

## Why the amount is unsigned

A penalty and a bonus point in opposite directions — but WHICH direction
depends on who is looking, and that is exactly why the sign is not stored.

To the **pool**, a penalty is money in and a bonus is money out. To the
**technician**, a penalty is a debit and a bonus is a credit — the reverse. The
console's ledger prints `−₹800` for a penalty and `+₹400` for a bonus, which is
the technician's reading; the pool balance above needs the other one. Storing a
sign would mean picking one reader and making the other negate it, and a
negation somebody forgets is a number that is wrong by twice itself.

So `amount_paise` is a magnitude and `kind` says which way it points. Every
reader applies its own sign, out loud, where it can be seen.

## Nothing here is ever edited or deleted

No `SoftDeleteMixin`, for the same reason `ticket_proofs` has none: this is a
record of money, and a correction is a NEW entry rather than a rewrite of an
old one. `updated_at` / `updated_by` come in from the mixin unused, exactly as
they do on `ticket_events`, because a table that is *almost* like every other
table but not quite is the kind of exception people trip over later.
"""

import uuid

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin

#: What the entry is.
#:
#: `payout` joined the other two when installs became priced, and it arrived
#: WITH its writers — `feedback_service.record_feedback` on a customer-confirmed
#: closure and `tickets.force_close_ticket` on a manager's. Hard rule 8:
#: `audit_logs` shipped a vocabulary ahead of its rows and stayed empty.
#: `adjustment` is still absent for exactly that reason.
#:
#: ⚠ A payout is NOT pool money. The pool is the penalty/bonus circuit — money
#: in equals money out — and a payout is the company paying for work done, from
#: outside it. `core.ledger.pool` and `earnings.summary` are safe by
#: construction (both read `totals.get("penalty")` / `("bonus")` by name), but
#: `features/ledger` had to be taught to exclude it explicitly.
LEDGER_KINDS = ("penalty", "bonus", "payout")

#: The two that net against each other in the pool balance.
POOL_KINDS = ("penalty", "bonus")


class LedgerEntry(Base, IdMixin, AuditMixin):
    __tablename__ = "ledger_entries"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: COMPOSITE FK — see __table_args__. RESTRICT: a technician who has been
    #: charged or paid cannot be deleted out from under the money.
    technician_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    #: The job the money is about. Every entry has one — a penalty is for
    #: cancelling a specific ticket and a bonus is for picking one up — so this
    #: is NOT nullable, and a future entry that genuinely has no ticket (a
    #: monthly adjustment, say) is a change to make when its writer exists.
    ticket_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)

    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    #: PAISE, and always positive. `kind` carries the direction — see the
    #: module docstring for why the sign is not stored.
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)

    #: What to show in the "Reason" column, as text, decided when it happened.
    #:
    #: Stored rather than re-derived, and it is the same exception
    #: `notifications.title` makes: the band label comes from a tuple that a
    #: ruling can change and the amount from a column a company can edit, so
    #: recomputing "Cancel < 2h before slot" next year could describe the entry
    #: with a rule that did not exist when it was written. A record of money
    #: says what was true at the time.
    reason: Mapped[str] = mapped_column(String(160), nullable=False)

    __table_args__ = (
        CheckConstraint("kind IN ('penalty', 'bonus', 'payout')", name="kind"),
        # `> 0`, not `>= 0`. A zero-rupee entry is not a smaller movement, it is
        # the absence of one, and the absence is spelled "write no row". The one
        # place that could produce a zero — a technician whose monthly cap is
        # already spent — writes nothing instead, and says so where it decides.
        CheckConstraint("amount_paise > 0", name="amount_paise"),
        # The ledger list: one company's entries, newest first.
        Index("ix_ledger_entries_company_created", "company_id", "created_at"),
        # Two jobs at once, which is why it is one index and not two: the
        # covering index the `(company_id, technician_id)` FK needs, and the
        # monthly-cap query — "what has this technician been charged since the
        # first of the month" — which reads the prefix and then the date.
        Index(
            "ix_ledger_entries_company_technician",
            "company_id",
            "technician_id",
            "created_at",
        ),
        # The covering index for the ticket FK. Postgres creates none, and
        # without it deleting one ticket scans the whole ledger.
        Index("ix_ledger_entries_company_ticket", "company_id", "ticket_id"),
        ForeignKeyConstraint(
            ["company_id", "technician_id"],
            ["technician_profiles.company_id", "technician_profiles.id"],
            name="fk_ledger_entries_company_technician",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["company_id", "ticket_id"],
            ["tickets.company_id", "tickets.id"],
            name="fk_ledger_entries_company_ticket",
            ondelete="RESTRICT",
        ),
    )
