"""What a technician is shown about a job, before and after they accept.

Deliberately NOT `TicketOut`. That shape carries `customerName`,
`customerPhone`, `address` and `slotLink` unconditionally, because every caller
of the tickets slice is staff or the vendor who raised it. A technician
deciding whether to take a job is neither, and `app/models/ticket.py` says so on
the columns themselves: the phone and the street line are "masked from
technicians until they accept".

Masking by omission rather than by asterisks. `maskedCustomer` exists because
the approved design shows one — `R•••• M••••` tells a technician there IS a
customer without telling them who — but the address and phone are simply not in
`JobOfferOut`. A field the server never sends cannot be read out of a response
by anyone curious enough to open the network tab, and that is a stronger
guarantee than a string the server chose to obscure.
"""

import datetime
import uuid
from typing import Literal

from pydantic import Field

from app.core.schemas import AppModel


class JobOfferOut(AppModel):
    """One job in the pool. Everything a technician needs to decide, and no more."""

    id: uuid.UUID
    #: `INST-240912`. What the cards render and what ops quote on the phone —
    #: the UUID is only ever a route param.
    code: str
    subcategoryName: str
    modelName: str
    serviceType: str
    #: Area and pincode are enough to judge the trip. The street line is not
    #: here at all — see the module docstring.
    city: str
    pincode: str
    #: Both always present in the pool: a job with no slot is `Slot Pending`
    #: and no technician is told it exists.
    slotStart: datetime.datetime
    slotEnd: datetime.datetime
    serviceLevelHours: int
    #: `R•••• M••••`. Enough to know a real person is waiting.
    maskedCustomer: str
    #: **Always null today.** There is no payout column on `tickets` — what a
    #: job pays belongs to the ledger, which does not exist yet. Sent as an
    #: explicit null rather than omitted so the client renders "—" instead of a
    #: confident ₹0, which would be a claim about money nobody has made.
    payoutPaise: int | None = None


class JobOut(JobOfferOut):
    """The same job once it is THIS technician's. The masked fields, unmasked.

    Returned by accept, by `GET /jobs/{id}` and by the my-jobs list — in every
    case only to the technician the ticket is actually assigned to, which the
    query enforces rather than the schema. There is no path by which the three
    unmasked fields reach anyone who has not committed to the slot.
    """

    customerName: str
    customerPhone: str
    address: str
    #: The full street line needs its state as well as its city — a technician
    #: navigating there is given the address as the customer wrote it.
    state: str

    #: The ticket's own status word (`Assigned`, `In Progress`, `Closed`…), not
    #: a client-side guess. The pool could omit it because everything in the
    #: pool is `New` by definition; an accepted job cannot, because "am I due to
    #: do this or have I done it" is the whole question My jobs asks.
    status: str
    #: Why the customer called. Null for `Installation + Demo`, required for
    #: `Tech Visit` and `Service` — see the CHECK on `tickets.description`.
    description: str | None
    #: The serial the vendor holds on the invoice, which the technician
    #: photographs and AI verification compares against. Mandatory at intake, so
    #: never null in practice.
    serialNumber: str

    #: Whether the customer's confirmation link actually went: not_needed |
    #: pending | sent | failed.
    #:
    #: The app needs this to avoid telling a technician "the customer has been
    #: sent a link" when Meta refused it. The technician is still standing in
    #: the customer's house at that moment and can say it in person — but only
    #: if the screen tells them the truth.
    feedbackRequestStatus: str

    #: What was read on site, and how. Null until proof is submitted.
    observedSerial: str | None
    observedSerialSource: str | None
    #: Derived, never stored: `observed_serial` present and different from
    #: `serial_number`. A stored copy would go stale the moment somebody
    #: corrected either one.
    serialMismatch: bool

    # ── what the customer said ────────────────────────────────────────────
    #
    # Written by the confirmation page and, until now, read by nothing: the
    # rating fed the technician's aggregate score and the words reached only the
    # ticket timeline, where the app cannot see them. A technician looking at
    # their own 3.8 had no way to find out what any of it was based on.
    #
    #: 1–5, or null. Null is a real answer — a customer may confirm the work
    #: without rating it — and it must render as "not rated", never as 0.
    customerRating: int | None
    #: Their words, as typed. Null when they left the box empty.
    customerFeedback: str | None
    #: When they answered. Null while still `Awaiting Customer`, which is how
    #: the app tells "no verdict yet" from "confirmed without comment".
    customerConfirmedAt: datetime.datetime | None
    #: True when the customer said the work was NOT finished. The rating is
    #: beside the point in that case — this is the fact the screen leads with,
    #: and the one a manager opens the ticket for.
    customerRefused: bool


class ProofArtifactIn(AppModel):
    """One captured image, as the app reports it after uploading.

    `blobName`, not a URL: proof lives in a private container and is read
    through short-lived signed links, so there is no stable URL to send. The
    client gets this name back from `POST /uploads?kind=proof`.

    `capturedAt` is the PHONE's clock at the shutter, not the server's receive
    time. A technician can be offline for an hour between capturing and
    uploading, and when the photo was taken is the fact that matters.
    """

    kind: Literal["barcode", "serial", "photos", "live"]
    blobName: str = Field(min_length=1, max_length=255)
    capturedAt: datetime.datetime
    #: 1 for the three single-shot kinds; 1–4 for product photos, in order.
    ordinal: int = Field(default=1, ge=1, le=4)

    #: Where the phone was. Sent only for `live` — that shot is the one claiming
    #: attendance. Null is accepted and recorded rather than refused: a denied
    #: permission or a lost fix is a fact about the proof, and blocking the
    #: upload over it would strand a technician who has finished the work.
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    accuracyM: float | None = Field(default=None, ge=0)
    #: The postal code the phone reverse-geocoded from those coordinates. The
    #: server refuses a `live` artifact whose code disagrees with the ticket's.
    #: Null is accepted — geocoding can fail while the fix is good — but the
    #: coordinates are then mandatory, so a live photo can never carry no
    #: location at all.
    devicePincode: str | None = Field(default=None, max_length=6)


class ProofSubmitRequest(AppModel):
    """Every artifact for one job, submitted in a single call.

    All four kinds together rather than one call per image, because they land in
    the same transaction as the status change — a half-submitted proof set is a
    state this is designed never to reach.
    """

    artifacts: list[ProofArtifactIn] = Field(min_length=1, max_length=7)

    #: The serial the technician actually found — off the barcode, or typed in
    #: when it would not scan. Compared with the ticket's expected serial and
    #: recorded either way; a mismatch is never a refusal.
    observedSerial: str | None = Field(default=None, max_length=64)
    observedSerialSource: Literal["scanned", "manual"] | None = None


class ProofImageOut(AppModel):
    """One stored artifact, with a link that expires."""

    kind: str
    ordinal: int
    capturedAt: datetime.datetime
    #: What the phone said its postal code was, for comparison with the job's.
    devicePincode: str | None
    #: A signed URL valid for a few minutes, minted per read. Null when blob
    #: storage is unconfigured — the record still exists, the picture just
    #: cannot be shown right now.
    url: str | None
    latitude: float | None
    longitude: float | None
