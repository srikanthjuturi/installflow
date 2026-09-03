"""Ticket request/response models.

Two rules live here rather than in the service, because they are shape rules
rather than data rules — they can be decided from the request alone:

  * a Tech Visit or Service ticket must carry a description, and an
    Installation + Demo ticket must not;
  * a slot is both ends or neither.

The rule that CANNOT live here is "the service type must be one this model
supports" — that needs the model row, so it is in the service. Neither can
"the model is one of the caller's own", for the same reason.
"""

import datetime
import uuid
from typing import Annotated

from pydantic import BaseModel, Field, model_validator

from app.core.coordinates import IndiaLatitude, IndiaLongitude
from app.core.phone import Phone
from app.core.schemas import AppModel
from app.core.service_types import SERVICE_TYPES
from app.core.statutory import Address, CityState, Pincode
from app.core.tickets import (
    DEFAULT_SERVICE_LEVEL_HOURS,
    DESCRIPTION_REQUIRED_FOR,
    SERVICE_LEVEL_HOURS,
)

ServiceLevelHours = Annotated[int, Field(description="12, 24, 36 or 48")]
Name255 = Annotated[str, Field(min_length=2, max_length=255)]
#: MANDATORY since vendors raise their own tickets. It was optional while ops
#: typed them and often did not have it — but the vendor holds the invoice and
#: the delivery note, so it is knowable at intake now, and the AI proof check
#: always has an expected serial to compare the photographed one against.
SerialNumber = Annotated[str, Field(min_length=1, max_length=64)]
#: Long enough to be a sentence about the fault, not "broken".
Description = Annotated[str | None, Field(default=None, max_length=2000)]


class TicketCreateRequest(BaseModel):
    #: NB there is no `vendorId`. The vendor comes from the caller's own account
    #: — a vendor does not choose which vendor it is, and a field that could
    #: name one would be the whole tenancy boundary sitting in a request body.
    subcategoryId: uuid.UUID
    modelId: uuid.UUID
    serviceType: str
    description: Description = None
    serialNumber: SerialNumber

    customerName: Name255
    customerPhone: Phone
    address: Address
    city: CityState
    state: CityState
    pincode: Pincode
    #: Where the address is, when the client resolved it through a map rather
    #: than the user typing it. Optional, and both or neither.
    #:
    #: Sending them buys a real proof check — the live site photo is then
    #: verified by DISTANCE from this point instead of by pincode equality. Not
    #: sending them is not a degraded ticket; it is what the Excel and API
    #: intake channels will always do, and those tickets keep the pincode rule.
    #:
    #: Bounded to India, unlike the phone's own position on a proof artifact: a
    #: customer address outside the country is a bug in the client, and storing
    #: one would silently refuse every technician who ever attends the job.
    latitude: IndiaLatitude = None
    longitude: IndiaLongitude = None

    expectedDate: datetime.date
    serviceLevelHours: ServiceLevelHours = DEFAULT_SERVICE_LEVEL_HOURS
    #: Omit both for a ticket whose slot has not been agreed yet — it lands as
    #: "Slot Pending" and the customer is asked to pick.
    slotStart: datetime.datetime | None = None
    slotEnd: datetime.datetime | None = None

    @model_validator(mode="after")
    def _check(self) -> "TicketCreateRequest":
        if self.serviceType not in SERVICE_TYPES:
            raise ValueError(
                f"Unknown service type: {self.serviceType}. "
                f"Choose from {', '.join(SERVICE_TYPES)}."
            )
        if self.serviceLevelHours not in SERVICE_LEVEL_HOURS:
            raise ValueError(
                "Service level must be one of "
                f"{', '.join(str(h) for h in SERVICE_LEVEL_HOURS)} hours"
            )

        text = (self.description or "").strip()
        if self.serviceType in DESCRIPTION_REQUIRED_FOR:
            if len(text) < 10:
                raise ValueError(
                    f"Describe the problem — a {self.serviceType} needs to say what "
                    "is wrong, or the technician arrives blind"
                )
        elif text:
            # Refused rather than ignored: a description silently dropped is a
            # customer's words thrown away without anybody noticing.
            raise ValueError(
                "Only a "
                f"{' or '.join(DESCRIPTION_REQUIRED_FOR)} ticket takes a "
                f"description — {self.serviceType} does not"
            )
        self.description = text or None

        # Half a point is not a place — the same rule the table states as a
        # CHECK. A latitude alone would be stored and then silently never
        # consulted, which is worse than refusing it.
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("A map position needs both a latitude and a longitude")

        if (self.slotStart is None) != (self.slotEnd is None):
            raise ValueError("A slot needs both a start and an end")
        if self.slotStart and self.slotEnd and self.slotEnd <= self.slotStart:
            raise ValueError("The slot must end after it starts")
        return self


class TicketOut(AppModel):
    id: uuid.UUID
    code: str

    vendorId: uuid.UUID
    vendorName: str
    subcategoryId: uuid.UUID
    #: The parent category name — the tree level the console groups by.
    categoryName: str
    subcategoryName: str
    modelId: uuid.UUID
    modelName: str

    serviceType: str
    description: str | None
    serialNumber: str | None
    #: What the technician actually read on site, and how. Null until proof is
    #: submitted. `serialNumber` above stays the EXPECTED one.
    observedSerial: str | None = None
    observedSerialSource: str | None = None
    #: Derived on every read from the two above — never stored, because a
    #: stored copy would be wrong the moment either one was corrected.
    serialMismatch: bool = False

    customerName: str
    customerPhone: str
    address: str
    city: str
    state: str
    pincode: str
    #: Null when the address was typed rather than picked off a map. Exposed
    #: because it decides which rule the proof photo is judged by, and "why was
    #: this technician refused and that one not" is otherwise unanswerable from
    #: the console.
    latitude: float | None
    longitude: float | None

    expectedDate: datetime.date
    serviceLevelHours: int
    slotStart: datetime.datetime | None
    slotEnd: datetime.datetime | None
    slaDueAt: datetime.datetime
    #: Derived on every read from the slot, the due time and the status — never
    #: stored, because it changes with the clock and a stored copy would be
    #: wrong the moment nobody looked at it.
    slaState: str

    status: str
    technicianId: uuid.UUID | None
    technicianName: str | None

    #: What a manager attached to a re-notification after nobody accepted, in
    #: PAISE. Null means no bonus was ever funded — a different claim from ₹0,
    #: and the console renders it as "—" for exactly that reason.
    bonusPaise: int | None = None

    #: What the vendor is charged for this job, in paise. Stamped at intake.
    #: Everyone who can see the ticket sees this, the vendor included — it is
    #: their own price, and there is nothing to hide from the person paying it.
    vendorPricePaise: int

    #: What the technician is paid for this job, in paise. Stamped at intake.
    #:
    #: **NULL for a vendor principal, always.** `_hydrate` never populates it
    #: for one, so the wire carries `null` — not the figure, and not a masked
    #: rendering of the figure either. That is the substance of the rule in
    #: `features/jobs/schemas.py`: what a vendor must not be able to do is read
    #: our technician rates out of their own network tab, and an absent value
    #: gives them nothing to read. (It is `null` rather than a missing key only
    #: because the envelope serialises with `exclude_unset=False`; making the
    #: key vanish would need `response_model_exclude_unset` on the route, which
    #: would also drop every other legitimately-null field and break clients
    #: that read `bonusPaise: null`.)
    #:
    #: The column itself is NOT NULL, so a null here is never "unpriced" — it is
    #: only ever "not yours to see". Staff always get the number.
    technicianPayoutPaise: int | None = None

    #: not_needed (ops set the slot) | pending | sent | failed.
    slotRequestStatus: str
    #: Meta's own words when it refused, so ops can act rather than guess.
    slotRequestError: str | None
    #: When the CUSTOMER picked. Null when ops entered the slot themselves —
    #: which is how the console tells "they chose this" from "we did".
    slotConfirmedAt: datetime.datetime | None
    #: The scheduling link, so ops can copy it out when WhatsApp refuses and
    #: read it down the phone. Present only while the slot is still theirs to
    #: pick; it disappears the moment it is used.
    slotLink: str | None

    # ── the customer's verdict ────────────────────────────────────────────
    #
    # Written by the confirmation page and, until now, surfaced only as a line
    # in the timeline — where a manager investigating an escalation had to find
    # it among thirteen kinds of event.
    #
    #: 1–5, or null. Null is a real answer: a customer may confirm the work
    #: without rating it, and that must read as "not rated" rather than 0.
    customerRating: int | None
    #: Their words, as typed.
    customerFeedback: str | None
    #: When they answered. Null means still waiting on them.
    customerConfirmedAt: datetime.datetime | None
    #: They answered and said the work is NOT finished. The reason matters more
    #: than the score here, and this is what the console leads with.
    customerRefused: bool

    createdAt: datetime.datetime


class TimelineEventOut(AppModel):
    """One entry in a ticket's audit trail.

    One row of `ticket_events`, written when the thing happened. It used to be
    DERIVED from the ticket's current columns, which meant it could never say
    when anything changed — and the mock version of the same idea derived a
    seven-event trail from `status` alone, "Notified 6 eligible technicians" for
    a ticket nobody had notified. That is exactly the kind of detail people
    believe.
    """

    at: datetime.datetime
    kind: str
    title: str
    #: staff | technician | customer | vendor | system.
    #:
    #: WHO caused it, as a value rather than as wording. `title` already says
    #: it in English — "Technician accepted" against "Assigned by a manager" —
    #: but a client that needs the distinction elsewhere on the page should not
    #: have to match on a display string, which is presentation and free to
    #: change. The console reads this to say how a technician came to hold the
    #: job on the panel beside the trail.
    actorKind: str
    #: Null for an event nobody caused — an SLA breach has no actor.
    by: str | None = None
    note: str | None = None


class TicketDetailOut(TicketOut):
    timeline: list[TimelineEventOut] = []

    #: What the technician was ACTUALLY credited for this job, in paise.
    #:
    #: Read from `ledger_entries`, not stored on the ticket, and that is the
    #: point: the ledger is where money lives, and a column here could drift
    #: from it. Normally equal to `technicianPayoutPaise`, but a force-closure
    #: credits an amount the manager chose — often less, sometimes nothing.
    #:
    #: Null means nothing has been credited yet, which is every open ticket and
    #: also a force-closure the manager paid nothing for. Both render "—";
    #: neither is ₹0, which would assert a payment of zero was made.
    #:
    #: Withheld from a vendor, exactly as `technicianPayoutPaise` is — it is the
    #: same fact, one step later.
    technicianCreditedPaise: int | None = None


class TicketProofOut(AppModel):
    """One proof image, as ops and the vendor see it.

    Deliberately its own model rather than the jobs slice's `ProofImageOut`:
    slices never import each other, and the two audiences are not the same. A
    technician looks at their own captures; ops and the vendor are looking at
    somebody else's work, usually because a customer said it was not done.
    """

    kind: str
    ordinal: int
    capturedAt: datetime.datetime
    #: Signed and short-lived, minted per read. Null when blob storage is
    #: unconfigured, or when a row's name does not belong to this company —
    #: the record still exists, the picture is simply not served.
    url: str | None
    #: Where the phone was for the live shot; null on the other three, and null
    #: on a live shot where location was denied or never fixed.
    latitude: float | None
    longitude: float | None
    accuracyM: float | None
    #: What the phone reverse-geocoded its position to. Compare it with the
    #: ticket's own pincode when a customer disputes that anybody attended.
    devicePincode: str | None


class AssignRequest(AppModel):
    """Hand an escalated job to a named technician.

    One field, and deliberately no `companyId` or `pincode` beside it: the
    ticket supplies both, and the technician is re-resolved against the
    caller's own company before anything is written. An id in a body is an
    assertion, not a fact.
    """

    technicianId: uuid.UUID


class BonusRequest(AppModel):
    """Fund a re-notification and put the job back in the pool.

    PAISE, like every other money value that reaches this API (hard rule 9).
    The console's four approved bands are ₹200/400/600/800, which arrive here
    as 20000/40000/60000/80000 — but the amount is not constrained to them,
    because the bands are a design decision about a picker and this is the
    money boundary. `gt=0` is the real rule: zero is not a smaller incentive,
    it is the absence of one, and the absence is spelled "do not call this".
    """

    amountPaise: int = Field(gt=0, le=10_000_00)


class RenotifyOut(AppModel):
    """What a funded re-notification actually did.

    `notified` is a FIELD rather than a line in the envelope's `message`
    because the console's transport returns `data` and drops `message` — a
    count nobody can read is a count worth not computing.
    """

    ticket: TicketDetailOut
    #: How many eligible technicians the push actually went to. Zero is a real
    #: and important answer: it means the bonus cannot work, because nobody
    #: covers this pincode for this subcategory with room on that day.
    notified: int


class NoShowRequest(AppModel):
    """A manager confirming that nobody turned up.

    The note is optional and worth asking for: "customer says he never called"
    is the difference between a charge somebody can defend later and one they
    cannot. Nothing branches on it — it goes onto the trail beside the amount.
    """

    note: str | None = Field(default=None, max_length=255)


class ForceCloseAttachmentIn(AppModel):
    """One supporting file, already in blob storage.

    A NAME, not a URL, and not the bytes. The file went to the private
    container through `POST /uploads?kind=attachment` before this request was
    made — the same two-step every image in this system uses, and the reason
    `core.images` refuses a `data:` URL everywhere it appears.
    """

    blobName: str = Field(min_length=1, max_length=255)
    #: What it was called on the manager's machine, for the read-back list.
    #: Optional because it is a label, never a lookup key.
    fileName: str | None = Field(default=None, max_length=255)


class ForceCloseRequest(AppModel):
    """A manager ending a job the normal closure could not finish.

    All three fields are required, and that is §10's requirement rather than a
    form preference: a force-closure is a closure the CUSTOMER never agreed to,
    so the record has to stand on its own the day somebody disputes it. A reason
    says which of the three situations this was, the note says what was actually
    tried, and the attachments are the evidence for both.

    `reason` is free text within a length rather than an enum. The console
    offers the prototype's three approved lines and nothing else, but pinning
    them in a CHECK here would mean a migration every time ops want to reword
    one — and the value is read by people, never branched on by code.
    """

    reason: str = Field(min_length=1, max_length=160)
    #: Long enough to say what was tried. The console asks for 10 characters;
    #: the server agrees rather than trusting it, because "ok" is not a
    #: justification anybody can act on a year later.
    notes: str = Field(min_length=10, max_length=2000)
    #: At least one. An empty list is the one thing that would turn this screen
    #: into a plain status change with a sentence attached.
    attachments: list[ForceCloseAttachmentIn] = Field(min_length=1, max_length=10)

    #: What to credit the technician for a job the customer never confirmed, in
    #: paise. The manager decides, because only they know which of two very
    #: different situations this is.
    #:
    #: A technician who travelled to the address and found nobody home did real
    #: work and is owed something — rarely the full install fee, which is why
    #: this is not simply `technician_payout_paise`. A ticket whose customer
    #: never even confirmed a slot had nobody attend, and is owed nothing.
    #:
    #: `0` and omitted both mean "credit nothing", and both write NO ledger row
    #: — `amount_paise > 0` is a CHECK, and the absence of a movement is spelled
    #: "no row" rather than a zero one. Ignored entirely when the ticket has no
    #: technician: there would be nobody to pay.
    #:
    #: The ceiling is the ticket's own payout, enforced in the service where the
    #: ticket is in hand: a force-closure is a manager settling work, not a
    #: route to paying more than the job was ever worth.
    technicianPayoutPaise: int | None = Field(default=None, ge=0)


class TicketAttachmentOut(AppModel):
    """One force-closure attachment, served through a short-lived link."""

    ordinal: int
    fileName: str | None
    #: Signed and short-lived, minted per read — same as `TicketProofOut.url`.
    #: Null when blob storage is unconfigured, or when a row's name does not
    #: belong to this company: the record still exists, the file is simply not
    #: served.
    url: str | None
    uploadedAt: datetime.datetime


class SlaBreakdownOut(AppModel):
    """How the OPEN tickets are sitting against their windows.

    Terminal tickets are excluded rather than reported as a fourth `done` bucket:
    the bar is a health reading, and a company with ten thousand closed jobs would
    otherwise show a sliver of red beside a wall of grey and look permanently
    fine. `ok + warn + breach` is the whole of it, and it is also `openTickets`.
    """

    ok: int
    warn: int
    breach: int


class FunnelOut(AppModel):
    """Where the open work is sitting, in the order it moves through."""

    #: Raised, and the customer has not picked a time. Invisible to technicians.
    slotPending: int
    #: Somebody holds it — `Assigned` or `In Progress`.
    active: int
    #: Closed in the last 7 days, measured on `customer_confirmed_at`, which is
    #: written in the same UPDATE that sets the status. NOT `updated_at`, which
    #: any later edit would move and which would count a job closed in March
    #: because somebody corrected its serial yesterday.
    closedThisWeek: int


class AttentionOut(AppModel):
    """The four queues a manager is meant to clear, as counts.

    Each one is the SAME predicate as the screen or sweep it links to, so the
    number on the card and the rows behind it can never disagree — which is the
    single thing that makes a count worth putting on a dashboard.
    """

    #: `service.list_escalations`' live half.
    escalations: int
    #: Tickets sitting in `AI Review`. Nothing sets that status yet, so this is
    #: a real count that is genuinely 0 rather than a placeholder — and it starts
    #: reporting the moment AI verification writes its first row.
    aiReview: int
    #: `sweeps.sweep_force_close`, minus its notification de-dupe: the manager
    #: still has to act whether or not the bell was already rung.
    awaitingForceClose: int
    #: `sweeps.sweep_silent_slots`, on the same terms.
    slotNotConfirmed: int

    #: The two windows the counts above were measured with, sent so the card can
    #: SAY them. Both are `company_rules` columns, so the approved copy's "48h"
    #: and "6h" are this company's defaults rather than facts — and a card
    #: reading "No customer response 48h" over a query run at 24 would be the
    #: screen quietly lying about its own number. Same reasoning, and the same
    #: fix, as the sweeps quoting the threshold they selected on.
    forceCloseHours: int
    slotSilenceHours: int


class DashboardSummaryOut(AppModel):
    """Every figure the console's dashboard draws, in one round trip.

    ## There are no deltas here, and that is deliberate

    The approved design puts a movement chip on each tile ("▲ 4.2%"). A delta
    needs the same count as it stood at some earlier moment, and nothing in this
    database records that: there is no snapshot table, and the current rows
    cannot answer it — a ticket closed on Tuesday was open on Monday and leaves
    no trace of having been. Shipping a computed-looking percentage over no
    source is the one thing the house rule forbids outright, so the tiles render
    without a chip until something real backs one.

    ## Counted, not sampled

    Every figure is a `COUNT` over the caller's own scope — the same `scoped()`
    door the list and fetch-by-id use — so an Area Manager's dashboard describes
    their states and a national head's describes the country. A vendor never
    reaches it: the route carries `jobs.view`, which the portal roles hold, so
    the scope narrows to that vendor's own tickets, which is the honest answer
    for a surface they cannot open anyway.
    """

    #: Not closed, force-closed or cancelled. The denominator of `sla`.
    openTickets: int
    #: Of those, already past their window — `sla.breach`, promoted to a tile
    #: because it is the number that decides whether today is a normal day.
    breaching: int
    escalated: int
    aiFlagged: int
    sla: SlaBreakdownOut
    funnel: FunnelOut
    attention: AttentionOut


class SerialCorrectionRequest(AppModel):
    """Correcting the EXPECTED serial — the one taken off the invoice.

    Never the observed one. What the technician read on site is a record of what
    was there and is not editable by anybody; this fixes the number the order
    was raised with, which is where the mistake nearly always is.
    """

    serialNumber: str = Field(min_length=1, max_length=64)
    #: Optional, and worth asking for: "invoice says 88417" explains a
    #: correction that a bare value never will.
    reason: str | None = Field(default=None, max_length=255)
