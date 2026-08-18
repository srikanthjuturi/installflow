"""Ticket vocabulary — statuses, service levels, and how SLA is measured.

Lives in core rather than the tickets slice because the mobile jobs slice will
need the same words to describe a job, and hard rule 4 forbids importing them
from another slice.

## What the service level measures

**The slot must START within N hours of the ticket being created.**

This was a real decision, because the two sources disagree. The requirement
document (§5) has the customer picking "a slot within the ticket's SLA window",
which puts the window in place before they answer. The prototype's rules screen
says "24 hours from slot confirmation", which starts the clock only once they
have. They give opposite answers to one question — can a ticket go late while
the customer is silent? — and the answer here is YES. Silence burns the window.

That is what makes "Slot not confirmed — customer silent > 6h" a real number
rather than a decoration, and it is the reading that protects the customer
rather than the process.
"""

#: Hours. The slot must start within this long of the ticket being raised.
SERVICE_LEVEL_HOURS = (12, 24, 36, 48)
DEFAULT_SERVICE_LEVEL_HOURS = 24

#: The nine the approved prototype defines. Two are worth spelling out because
#: the names do not carry their meaning:
#:
#:   Slot Pending  raised, but nobody has agreed a time yet. No technician has
#:                 been told it exists.
#:   New           the slot is locked and the ticket is in the pool. Eligible
#:                 technicians can see it; none has accepted.
#:
#: There is no state between New and Assigned — Assigned already means somebody
#: took it.
TICKET_STATUSES = (
    "New",
    "Slot Pending",
    "Assigned",
    "In Progress",
    "AI Review",
    "Escalated",
    "Closed",
    "Force-Closed",
    "Cancelled",
)

#: The window is over for these — an SLA state of "done", whether or not it was
#: met, because there is nothing left to be late for.
TERMINAL_STATUSES = ("Closed", "Force-Closed", "Cancelled")

#: Service types that require the customer's problem in writing. An installation
#: explains itself; "it is making a noise" does not, and a technician sent
#: without it arrives blind and goes back for a second visit.
DESCRIPTION_REQUIRED_FOR = ("Tech Visit", "Service")

#: How much of the window has to be left before a ticket stops reading "On
#: track" and starts reading "Due soon".
SLA_WARN_AT = 0.25

#: Ordering for the list's default sort. The whole point of the screen is
#: triage, so the ones already late come first.
SLA_STATE_ORDER = ("breach", "warn", "ok", "done")
