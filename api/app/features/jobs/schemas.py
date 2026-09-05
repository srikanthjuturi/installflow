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

from app.core.coordinates import Latitude, Longitude
from app.core.schemas import AppModel


class ProductParameterOut(AppModel):
    """One spec off the product — `RAM` / `8 GB`.

    Declared here rather than imported from `features/masters`: slices never
    import each other (hard rule 4), and two strings are not worth promoting to
    `app.core` for a second consumer.
    """

    name: str
    value: str


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
    #: NULL when the customer has not picked a time yet, which is a real and
    #: common state — the job is offered from the moment it is raised, in
    #: parallel with the WhatsApp asking them to choose. Both are null together
    #: or neither is.
    #:
    #: This used to promise both were always present. That was true while the
    #: pool waited for a confirmed slot, and it is the assumption every date
    #: formatter on the phone was written against — a null one rendered
    #: "Invalid Date" rather than blank, because `new Date(null)` is not an
    #: error, it is a wrong answer.
    slotStart: datetime.datetime | None = None
    slotEnd: datetime.datetime | None = None
    #: When the service level runs out. Always present, and it is what a slotless
    #: offer counts down to: with no slot there is no other deadline, and the
    #: card needs something honest to show in that space.
    slaDueAt: datetime.datetime
    serviceLevelHours: int
    #: `R•••• M••••`. Enough to know a real person is waiting.
    maskedCustomer: str
    #: What this job pays the technician, in paise — `tickets.payout` as stamped
    #: at intake from the product model, so a later repricing never changes what
    #: somebody was offered.
    #:
    #: NOT nullable. The ticket column is NOT NULL because `product_models`
    #: cannot hold an unpriced row, so "—" is not a state this can reach and the
    #: phone's `Job.payoutPaise` is a plain number all the way through.
    #:
    #: This shape carries no vendor price and must never grow one: the margin
    #: between what the vendor pays and what the technician earns is the
    #: company's, and this is the schema a technician receives.
    payoutPaise: int
    #: On top of the payout, when a manager funded a re-notification because
    #: nobody took this job the first time round. Null on almost every job.
    #:
    #: Unlike `payoutPaise` this one is REAL — `tickets.bonus_paise` — and it is
    #: the only reason a bonus works at all. An incentive the technician cannot
    #: see on the card they are deciding from incentivises nobody, which is why
    #: it travels on the masked offer rather than waiting for acceptance.
    bonusPaise: int | None = None


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

    #: Where the address actually is, when somebody picked it off a map at
    #: intake. Null for a typed address, and for every ticket raised before
    #: these existed — and the app must read that null as "fall back to the
    #: pincode", never as 0,0, which is in the Gulf of Guinea.
    #:
    #: On `JobOut` and deliberately NOT on `JobOfferOut`, per this module's
    #: docstring: a coordinate pair IS the customer's address, stated more
    #: exactly than the street line the pool already withholds.
    latitude: float | None
    longitude: float | None
    #: Metres. How far from that point the live proof photo may be taken — this
    #: company's `geo_radius_m`, sent with the job so the phone blocks its own
    #: shutter on the SAME number the server will refuse on. A client left to
    #: guess would refuse captures the server would have taken, or worse, allow
    #: ones it will not.
    geoRadiusM: int
    #: Whether either location rule is ENFORCED on this job — the vendor's own
    #: switch, read live rather than stamped, so it can be flipped while a
    #: technician is standing on the site.
    #:
    #: False does not mean "do not ask for a location". The phone still requests
    #: a fix and still attaches whatever it gets; what it must stop doing is
    #: blocking its own shutter, because with this off the server accepts a live
    #: photo taken anywhere — including one carrying no location at all.
    #:
    #: An older build that has never heard of this field keeps blocking, which
    #: is the safe way round: no server value can free an installed APK, so the
    #: switch is only fully effective after a rebuild.
    locationCheckEnabled: bool

    #: The ticket's own status word (`Assigned`, `In Progress`, `Closed`…), not
    #: a client-side guess. The pool could omit it because everything in the
    #: pool is `New` by definition; an accepted job cannot, because "am I due to
    #: do this or have I done it" is the whole question My jobs asks.
    status: str
    #: Why the customer called. Null for `Installation + Demo`, required for
    #: The product's own specs — panel type, capacity, whatever ops recorded.
    #:
    #: Read LIVE from `product_models`, not stamped on the ticket like the price
    #: and the rules. A spec is descriptive: correcting "8 GB" to "4 GB" should
    #: fix every job that names the product, because the unit on the wall never
    #: changed and the old value was simply wrong. Money and policy are the
    #: opposite — those are what the job was AGREED at, so they are frozen.
    #:
    #: On `JobOut` and not on `JobOfferOut`: the pool is a decision about a trip
    #: and a fee, and the offer deliberately carries as little as it can. The
    #: specs matter once the job is yours and you are standing in front of it.
    modelParameters: list[ProductParameterOut] = []
    #: Prose about the product, if ops left any — read as a sentence, so it is
    #: not a parameter.
    modelNotes: str | None = None
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
    latitude: Latitude = None
    longitude: Longitude = None
    #: Metres of error the phone reports on its own fix. Not decoration: the
    #: distance check subtracts it before comparing, so a technician whose
    #: phone admits it is unsure is not refused for the phone's uncertainty.
    accuracyM: float | None = Field(default=None, ge=0)
    #: The postal code the phone reverse-geocoded from those coordinates.
    #:
    #: Consulted ONLY for a ticket that has no coordinates of its own; one that
    #: does is judged by distance and this is ignored. Null is accepted —
    #: geocoding can fail while the fix is good — but the coordinates above are
    #: mandatory under both rules, so a live photo can never carry no location
    #: at all.
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


class PenaltyBandOut(AppModel):
    """What giving this job up costs, and whether it lands on a manager.

    Server-side, and that is the change rather than a detail: the app computed
    this from `hoursToSlot` on the DEVICE, so a phone with a wrong clock could
    talk itself into a cheaper band. Its own comment said as much.

    Three fields because the approved screen renders exactly three things — the
    band's name, the figure, and the escalation warning under four hours.
    """

    #: PAISE, and what will ACTUALLY be charged — not the band's face value.
    #: A technician who has already met their monthly cap is charged the
    #: remainder, which can be nothing.
    amountPaise: int
    #: The band's own words, e.g. `2–4h before slot`. Sent rather than derived
    #: on the phone so the label and the amount can never describe different
    #: rules.
    label: str
    #: Under this company's escalation window, so it goes straight to the Area
    #: Service Manager. Drives the red banner on the cancel screen.
    escalates: bool


class CancelRequest(AppModel):
    """Why they are giving the job up.

    A free string rather than an enum of the app's five reasons. The list is a
    presentation choice on one screen — the prototype's five radio buttons —
    and pinning it here would mean a migration every time somebody edits a
    label. The trail records what was said; nothing branches on it.
    """

    reason: str = Field(min_length=2, max_length=120)


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
