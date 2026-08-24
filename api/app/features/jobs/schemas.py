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

    Returned only by accept, and only to the technician the guarded UPDATE just
    named — so there is no path by which these three reach anyone who has not
    committed to the slot.
    """

    customerName: str
    customerPhone: str
    address: str
