"""What a technician has earned, and what it cost them.

Paise on the wire, like every other money figure this API sends. The phone
formats it — `formatPaise` renders null as "—", which is load-bearing here.
"""

import datetime
import uuid

from app.core.schemas import AppModel


class EarningsSummaryOut(AppModel):
    """The four figures on the Earnings hero, for one period.

    All four are real, and all four come out of `ledger_entries` in one grouped
    query — so the three tiles and the big number above them can never be read
    from different moments:

        net = earned + bonuses − penalties

    `earnedPaise` and `netPaise` were `None` until installs were priced, and the
    screen printed a dash under a line apologising for it. The refusal to
    substitute `bonuses − penalties` in the meantime is worth remembering now
    that it is gone: it would have shown a technician who cancelled one job and
    did five unpriced installs a net of **−₹300** for the week. Not a smaller
    truth than a dash — a different and alarming lie.
    """

    #: Earned + bonuses − penalties. May be NEGATIVE in a week of heavy
    #: cancellation and little work, which is a true thing to say; the phone
    #: renders the minus. The monthly penalty cap bounds how far it can go.
    netPaise: int
    #: What the JOBS paid — `payout` + `travel` entries, written at closure.
    earnedPaise: int
    #: Travel allowances credited in the period — `travel` entries, written at
    #: closure. Employees get these too (T3). A BREAKDOWN of `earnedPaise`,
    #: which already includes it — never add the two together (§8 trap 5).
    travelPaise: int = 0
    #: Escalation bonuses credited to this technician in the period. Since
    #: Task 11 (W10) this INCLUDES speed rewards — the two kinds move the same
    #: pool under the same signs, and the fold keeps `net = earned + bonuses −
    #: penalties` saying the same thing to every build already installed.
    bonusesPaise: int
    #: Real, and POSITIVE — a magnitude, not a debit. The screen colours it and
    #: signs it; the API does not decide how somebody's own money reads to
    #: them. Since Task 11 (W10) this INCLUDES speed penalties, for the same
    #: reason.
    penaltiesPaise: int

    #: BREAKDOWNS, not extra tiles — the speed kinds inside the two above
    #: (W10), sent additive for Task 15's display. Default 0 and never summed
    #: on top of `bonusesPaise` / `penaltiesPaise`, exactly as `travelPaise` is
    #: never added to `earnedPaise`.
    speedRewardPaise: int = 0
    speedPenaltyPaise: int = 0

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
    #: `payout` | `travel` | `bonus` | `penalty` | `speed_reward` |
    #: `speed_penalty` (Task 11). The phone picks the icon and the sign from
    #: this — `payout`, `travel`, `bonus` and `speed_reward` are credits,
    #: `penalty` and `speed_penalty` are debits (`title` names them either way).
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
    #: The job to OPEN when the row is tapped — or null, which is not an
    #: oversight but the answer.
    #:
    #: Every entry has a `ticket_id` (it is NOT NULL), but only some of those
    #: tickets are still this technician's: cancelling CLEARS `technician_id`
    #: and hands the job back to the pool, so `GET /jobs/{id}` 404s on exactly
    #: the ticket the penalty beside it was charged for. Sending the id anyway
    #: would give the phone a link that is broken by design.
    #:
    #: So this is populated only while the ticket is still assigned here — the
    #: same fact the detail endpoint checks, resolved once rather than guessed
    #: from `kind`. A payout is tappable; a penalty for a released job is not.
    ticketId: uuid.UUID | None = None
