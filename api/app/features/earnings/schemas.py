"""What a technician has earned, and what it cost them.

Paise on the wire, like every other money figure this API sends. The phone
formats it — `formatPaise` renders null as "—", which is load-bearing here.
"""

import datetime
import uuid

from app.core.schemas import AppModel


class EarningsSummaryOut(AppModel):
    """The four figures on the Earnings hero, for one period.

    ## Two of them are NULL, and that is the honest answer

    `earnedPaise` is what the JOBS themselves pay, and there is no source for
    it: `tickets` has no payout column, and nothing anywhere prices an install.
    `jobs.schemas.JobOfferOut.payoutPaise` has said so since it was written —
    *"sent as an explicit null rather than omitted so the client renders '—'
    instead of a confident ₹0, which would be a claim about money nobody has
    made"*.

    `netPaise` is null for a consequence of that, and this is the important
    one. Net is earned + bonuses − penalties. With `earned` unknown the sum is
    unknown, and the tempting substitute — showing bonuses minus penalties — is
    not a smaller truth, it is a different and alarming lie: a technician who
    cancelled one job and earned no bonus would open this screen to
    **−₹300**, presented as their net pay for the week, having actually done
    five installs that nothing has priced yet.

    Both become real the day payouts do, and nothing on the phone changes: the
    screen already renders null as "—".

    The other two are real now, out of `ledger_entries`.
    """

    #: Null until installs are priced — see above. Never zero.
    netPaise: int | None
    #: Null for the same reason.
    earnedPaise: int | None
    #: Real. Escalation bonuses credited to this technician in the period.
    bonusesPaise: int
    #: Real, and POSITIVE — a magnitude, not a debit. The screen colours it and
    #: signs it; the API does not decide how somebody's own money reads to
    #: them.
    penaltiesPaise: int

    #: The IST calendar days these figures actually cover, inclusive at both
    #: ends — what the request RESOLVED to, not what it asked for.
    #:
    #: Here so the phone can label the money with the span it is the money for.
    #: `period` and `dateFrom`/`dateTo` are two ways to ask, an unknown period
    #: falls back to the week, and a client can always be newer than the server
    #: it is talking to — so "what did you answer over" is a real question with
    #: a real answer, and the screen should not have to guess it.
    dateFrom: datetime.date
    dateTo: datetime.date


class TransactionOut(AppModel):
    """One line of a technician's own ledger."""

    id: uuid.UUID
    at: datetime.datetime
    #: `bonus` | `penalty`. The phone picks the icon and the sign from this.
    kind: str
    #: PAISE, always positive. See `models/ledger.py` on why no sign is stored.
    amountPaise: int
    #: What to print in bold — resolved here rather than on the phone because
    #: it depends on which band the row came from, which is a server fact.
    title: str
    #: The line under it: when, and which job.
    subtitle: str
    #: `INST-240912`, so a technician can quote it when they disagree.
    ticketCode: str
