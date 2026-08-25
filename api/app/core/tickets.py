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
#:
#:   Awaiting Customer  the technician has finished and uploaded proof, and the
#:                      customer has been sent a link to confirm it. NOT the
#:                      same as In Progress, where somebody is still working,
#:                      and not the same as Closed, because in this app the
#:                      CUSTOMER closes a job, not the technician. A ticket can
#:                      sit here indefinitely: nothing chases a silent customer
#:                      yet.
TICKET_STATUSES = (
    "New",
    "Slot Pending",
    "Assigned",
    "In Progress",
    "Awaiting Customer",
    "AI Review",
    "Escalated",
    "Closed",
    "Force-Closed",
    "Cancelled",
)

#: The four artifacts a technician captures on site, in the order the app walks
#: them. `photos` is the only one that repeats — 1 to 4 shots of the installed
#: unit; the other three are exactly one each.
PROOF_KINDS = ("barcode", "serial", "photos", "live")
MIN_PRODUCT_PHOTOS = 1
MAX_PRODUCT_PHOTOS = 4

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


# ── the windows a customer may pick from ─────────────────────────────────────

#: Two-hour windows, in local working hours. Offered as whole blocks rather than
#: a free time picker because a technician's day is a round of appointments, not
#: a diary — "3:00 to 5:00 PM" is a promise that can be kept, "2:37" is not.
#:
#: The day runs 5 AM to 9 PM. It used to be 9 AM to 7 PM, and that made the
#: 12-hour service level unusable for most of the afternoon: raised at 5 PM, its
#: deadline fell at 5 AM, by which time everything the same day was inside the
#: 90-minute lead and the next morning's 9 AM was already too late. The list
#: came back empty and the ticket could not be booked at all. Starting at 5 AM
#: is what makes that deadline reachable.
SLOT_WINDOWS = (
    (5, 7),
    (7, 9),
    (9, 11),
    (11, 13),
    (13, 15),
    (15, 17),
    (17, 19),
    (19, 21),
)

#: How long before a window opens it stops being offerable. Nobody can be sent
#: to an address in ten minutes, and offering a slot that cannot be served is
#: how a ticket breaches on the system's own suggestion.
SLOT_LEAD_MINUTES = 90

#: Local time for the offered windows. India is the whole market (see
#: `app/core/phone.py` for the same assumption), and a customer picking "3 PM"
#: means 3 PM where they live, not UTC.
SLOT_TIMEZONE_OFFSET_MINUTES = 330  # IST, UTC+05:30
