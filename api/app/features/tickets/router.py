"""Ticket endpoints — intake and the list.

**Only a vendor raises a ticket.** `jobs.create` is held by the two portal roles
and nobody else, and `POST` carries `require_vendor_principal` ON TOP of the
feature. The guard is not belt-and-braces: a feature grant is deliberately
overridable per company through Feature Access, so without it "vendor-only"
would last exactly until a company admin flipped one row. A rank floor cannot
express it either — a vendor sits BELOW every staff role, so a floor of `vendor`
would admit the entire company.

Staff keep `jobs.view`. They work tickets; they no longer raise them.

What each role SEES is narrowed in the service, and the two rules are different
in kind: staff see by GEOGRAPHY (their territory's pincodes), a vendor sees by
OWNERSHIP (tickets against its own brand), and a vendor USER sees only the ones
they raised themselves. Applied on the list and on fetch-by-id alike, so a
guessed id reads as 404 rather than a 403 that would confirm it exists.

Filters are matched case-insensitively and an unknown value yields an empty page
rather than a 422 — the lesson from the vendor list, where a stale bookmark
carrying `?status=Active` blanked the whole screen.
"""

import datetime
import uuid
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import (
    Principal,
    require_any_feature,
    require_feature,
    require_min_rank,
    require_staff_principal,
    require_vendor_principal,
)
from app.core.schemas import (
    ApiEnvelope,
    ListParams,
    PaginatedEnvelope,
    envelope,
    list_params,
    paginated,
)
from app.features.tickets import import_service, service
from app.features.tickets.schemas import (
    AssignRequest,
    BonusRequest,
    DashboardSummaryOut,
    ForceCloseRequest,
    IntakeStatusOut,
    NoShowRequest,
    PenaltyReverseRequest,
    RenotifyOut,
    RescheduleRequest,
    SerialCheckOut,
    SerialCorrectionRequest,
    SlotOptionOut,
    TicketAttachmentOut,
    TicketCreateRequest,
    TicketDetailOut,
    TicketImportReport,
    TicketOut,
    TicketProofOut,
)
from app.models.role import AREA_MANAGER, NATIONAL_HEAD

router = APIRouter(prefix="/tickets", tags=["tickets"])

Db = Annotated[AsyncSession, Depends(get_db)]
CanView = Annotated[Principal, Depends(require_feature("jobs.view"))]
CanCreate = Annotated[Principal, Depends(require_feature("jobs.create"))]
IsVendor = Depends(require_vendor_principal)

#: The bulk importer's own key, and it is NOT `jobs.create` — hard rule 2, "a
#: key that already exists is not automatically the right key". `jobs.create`
#: was deliberately revoked from all four staff roles by `d5f61c07ab29`, and
#: the console reads it to decide whether to draw a Raise-a-ticket screen;
#: re-granting it to let staff upload a file would hand single-ticket creation
#: back with it. Seeded to admin and national_head.
CanImportForVendor = Annotated[
    Principal, Depends(require_feature("jobs.import"))
]
IsStaff = Depends(require_staff_principal)
#: Paired with the feature because the act spends company money — 500 tickets
#: is 500 credit charges — which is the same pairing `jobs.force_close` and
#: `masters.approve` carry, and no per-company override can lift it.
NationalHeadUp = Depends(require_min_rank(NATIONAL_HEAD))

#: The template is a file of headings. Either side may fetch it, so either key
#: opens it — see the route for why it is not gated harder than that.
CanImport = Annotated[
    Principal, Depends(require_any_feature("jobs.create", "jobs.import"))
]

#: The escalation surface: the queue and the two ways out of it.
#:
#: BOTH guards, on all three routes, and neither is redundant.
#:
#: `jobs.assign` is the feature key hard rule 2 requires, and the console reads
#: it to decide whether to draw the rail entry — it has been seeded to admin,
#: national head, regional head and area manager since the initial migration and
#: read by nothing until now.
#:
#: `require_min_rank(AREA_MANAGER)` is what makes it stick. A feature grant is
#: deliberately overridable per company through Feature Access, so on the key
#: alone "Area Manager and above" would last exactly until somebody handed
#: `jobs.assign` to Ops Staff — and this is the screen that spends money and
#: commits a person's day. Same pairing, for the same reason, as
#: `vendors/router.py`.
#:
#: The rank floor also refuses vendors for free: a vendor ranks BELOW every
#: staff role, so it can never clear a floor of area manager.
CanAssign = Annotated[Principal, Depends(require_feature("jobs.assign"))]
AreaManagerUp = Depends(require_min_rank(AREA_MANAGER))

#: Ending a job on a manager's authority, without the customer.
#:
#: Its own feature rather than the `jobs.close` that already exists. That key
#: belongs to `admin` and `technician` and to nobody in between, because it
#: means "close your own job" — reusing it would either lock out every manager
#: this screen is FOR, or hand every technician the override that skips the
#: customer.
#:
#: Paired with the rank floor for the same reason the escalation surface is: the
#: feature grant is overridable per company on Feature Access, and this one ends
#: a job the customer never agreed was finished.
CanForceClose = Annotated[Principal, Depends(require_feature("jobs.force_close"))]

#: Giving a penalty back.
#:
#: Its own key rather than `jobs.assign`, which the no-show confirmation uses:
#: charging somebody and refunding them are different decisions, and a company
#: may reasonably let every Area Manager record a no-show while keeping refunds
#: with the National Head — one Feature Access row, with no deploy.
#:
#: Paired with `AreaManagerUp`, because it returns pool money (hard rule 2).
#: Together with `_load`'s territory scoping that is the whole of "the ticket's
#: AM, else its RH, else a NH, else an Admin — or anyone senior".
CanReversePenalty = Annotated[
    Principal, Depends(require_feature("penalties.reverse"))
]


@router.get("", response_model=PaginatedEnvelope[TicketOut])
async def list_tickets(
    db: Db,
    principal: CanView,
    params: Annotated[ListParams, Depends(list_params)],
    status: Annotated[str | None, Query()] = None,
    slaState: Annotated[str | None, Query()] = None,
    serviceType: Annotated[str | None, Query()] = None,
    technicianId: Annotated[uuid.UUID | None, Query()] = None,
    regionId: Annotated[uuid.UUID | None, Query()] = None,
    stateId: Annotated[uuid.UUID | None, Query()] = None,
    dateFrom: Annotated[datetime.date | None, Query()] = None,
    dateTo: Annotated[datetime.date | None, Query()] = None,
    open_: Annotated[bool, Query(alias="open")] = False,
    closedWithinDays: Annotated[int | None, Query(ge=1, le=365)] = None,
    attention: Annotated[str | None, Query()] = None,
) -> PaginatedEnvelope[TicketOut]:
    """One page of tickets, newest first.

    Sorted by when the ticket was raised, most recent first, unless the caller
    names a sort. `?sortBy=slaState` gives the triage view — the ones already
    late come first — and `?sortBy=createdAt&sortDir=asc` the oldest first.

    `technicianId` answers "what has this person worked", which is the console's
    technician profile. It needs no guard of its own: the query is already
    company-scoped and territory-scoped, so an id from another company — or from
    outside the reader's own area — narrows to nothing and returns an empty
    page. It cannot be used to discover that a technician exists.

    ## Four filters exist so the DASHBOARD's tiles can link honestly

    Every figure on that screen has to open a list holding exactly what it
    counted, and several of them are populations a single status cannot name:

      * `status` takes a comma-separated SET — `Assigned,In Progress` is the
        funnel's middle tile, `Closed,Force-Closed` its last. One value behaves
        as it always did.
      * `open=true` is "not yet closed", from `service.open_tickets()` — the
        same expression the `openTickets` tile counts.
      * `closedWithinDays=7` is "closed in the last N days", from
        `service.closed_in()` — the same expression the "Closed this week" tile
        counts, with the window it reports in `funnel.closedWithinDays`.
      * `attention=force-close` / `attention=slot-unconfirmed` are the two
        "Needs your attention" cards, from `service.awaiting_force_close()` and
        `service.slot_unconfirmed()` — the expressions those counts run. They
        linked to `status=Awaiting Customer` / `status=Slot Pending` before,
        which opened lists that disagreed with the number on the card.

    None of them widens anything: they narrow a list that `scoped()` has
    already cut to the caller's own territory.
    """
    rows, total = await service.list_tickets(
        db,
        principal,
        params,
        status_filter=status,
        sla_filter=slaState,
        service_type=serviceType,
        technician_id=technicianId,
        region_id=regionId,
        state_id=stateId,
        date_from=dateFrom,
        date_to=dateTo,
        open_only=open_,
        closed_within_days=closedWithinDays,
        attention=attention,
    )
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.get(
    "/intake-status",
    response_model=ApiEnvelope[IntakeStatusOut],
    dependencies=[IsVendor],
)
async def intake_status(db: Db, principal: CanCreate) -> ApiEnvelope[IntakeStatusOut]:
    """Whether a ticket raised now would be refused for want of credits.

    The vendor portal asks before drawing the form. `POST` still decides for
    real — this can go stale between the two — and answers 409 `OUT_OF_CREDITS`.
    Declared above `/{ticket_id}`, like `/summary`.
    """
    return envelope(await service.intake_status(db, principal))


# ── the bulk importer ────────────────────────────────────────────────────────
#
# All three are declared ABOVE `/{ticket_id}`, like `/summary` and
# `/intake-status`: a static segment outranks a dynamic one wherever it is
# declared, but keeping them together is what stops somebody adding a fourth
# below the catch-all and spending an afternoon on a 422 about "import" not
# being a UUID.
#
# TWO write routes, not one with a flag, and the split is the tenancy boundary.
# The vendor's route has NO field a vendor id could arrive in — the same
# structural pinning `TicketCreateRequest` uses, so no future branch can reopen
# it by forgetting a check. The staff route must name a vendor, so it takes one
# and resolves it through a company-scoped loader that 404s on anything else.


@router.get("/import/template")
async def ticket_template(principal: CanImport) -> StreamingResponse:
    """The starter .xlsx: one sheet of columns, one of instructions.

    On either import key, and NOT staff-only, for the reason
    `GET /masters/serials/template` is not either: the file carries no data at
    all — headers and two example rows, identical for every caller — and gating
    it harder than the thing it accompanies would only mean somebody guessing at
    the column names.
    """
    return StreamingResponse(
        import_service.build_ticket_template(),
        media_type=(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ),
        headers={"Content-Disposition": 'attachment; filename="tickets.xlsx"'},
    )


async def _read_upload(file: UploadFile) -> tuple[bytes, str]:
    """The extension and size guards both siblings apply, in one place."""
    name = (file.filename or "").lower()
    if not name.endswith((".xlsx", ".csv")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Upload an .xlsx or .csv file",
        )
    # Read with a ceiling rather than trusting the declared size: a client can
    # claim any content-length, and the body would otherwise be in memory before
    # any check that came after it. Lifted verbatim from `geo.import_geography`.
    data = await file.read(import_service.MAX_TICKET_UPLOAD_BYTES + 1)
    if len(data) > import_service.MAX_TICKET_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                "The file must be under "
                f"{import_service.MAX_TICKET_UPLOAD_BYTES // (1024 * 1024)} MB"
            ),
        )
    return data, name


def _import_message(report: TicketImportReport) -> str:
    if report.dryRun:
        return "Checked — nothing was saved"
    parts = [f"{report.imported} ticket{'' if report.imported == 1 else 's'} raised"]
    if report.categoriesCreated:
        parts.append(f"{report.categoriesCreated} categories created")
    if report.productsSubmitted:
        parts.append(f"{report.productsSubmitted} products sent for approval")
    return ", ".join(parts)


@router.post(
    "/import",
    response_model=ApiEnvelope[TicketImportReport],
    dependencies=[IsVendor],
)
async def import_own_tickets(
    db: Db,
    principal: CanCreate,
    file: Annotated[UploadFile, File()],
    dryRun: Annotated[bool, Query()] = True,
    createCategories: Annotated[bool, Query()] = False,
    submitProducts: Annotated[bool, Query()] = False,
    expectedDigest: Annotated[str | None, Query()] = None,
) -> ApiEnvelope[TicketImportReport]:
    """A vendor uploads its own sheet. `dryRun` writes nothing.

    `createCategories` and `submitProducts` default to FALSE. The confirmation
    the console shows is presentation; the affirmative has to arrive as a
    positive assertion, or the guard only guards clients that choose to ask.
    """
    data, name = await _read_upload(file)
    report = await import_service.import_tickets(
        db,
        principal,
        data,
        name,
        # THE pin. There is no field on this route for a vendor id to arrive in.
        vendor_id=principal.vendor_id,
        dry_run=dryRun,
        create_categories=createCategories,
        submit_products=submitProducts,
        expected_digest=expectedDigest,
        # A company's balance is not its vendor's business — the same line
        # `IntakeStatusOut` draws. They are told whether it FITS, not what is
        # left.
        show_credits=False,
    )
    return envelope(report, message=_import_message(report))


@router.post(
    "/import/on-behalf",
    response_model=ApiEnvelope[TicketImportReport],
    dependencies=[IsStaff, NationalHeadUp],
)
async def import_tickets_for_vendor(
    db: Db,
    principal: CanImportForVendor,
    vendorId: Annotated[uuid.UUID, Form()],
    file: Annotated[UploadFile, File()],
    dryRun: Annotated[bool, Query()] = True,
    createCategories: Annotated[bool, Query()] = False,
    submitProducts: Annotated[bool, Query()] = False,
    expectedDigest: Annotated[str | None, Query()] = None,
) -> ApiEnvelope[TicketImportReport]:
    """Staff upload a vendor's sheet for them.

    The one place in this slice where somebody other than a vendor causes a
    ticket to exist, and it needed its own feature key rather than `jobs.create`:
    that one was deliberately REVOKED from all four staff roles, and the console
    reads it to decide whether to draw a Raise-a-ticket screen. Re-granting it
    would undo that migration's whole point.

    The rank floor is National Head because a bulk file carries pincodes from
    anywhere. An Area Manager may only act inside their own states (hard rule
    3), so admitting one would mean a per-row territory reject — a confusing
    thing to tell somebody uploading a vendor's file. Above that level the
    territory rule does not apply at all, rather than applying by halves.

    `created_by` is the STAFF user, so the trail says who actually did it. ⚠ A
    consequence worth knowing: a `vendor_user` sees only tickets they raised
    themselves, so a ticket imported this way is visible to the vendor account
    but not to its sub-users. That is correct — they did not raise it — and
    nobody would guess it.
    """
    data, name = await _read_upload(file)
    report = await import_service.import_tickets(
        db,
        principal,
        data,
        name,
        # An id in a request is an assertion, not a fact: the service resolves
        # it through a company-scoped loader that 404s on anything outside the
        # caller's own company.
        vendor_id=vendorId,
        dry_run=dryRun,
        create_categories=createCategories,
        submit_products=submitProducts,
        expected_digest=expectedDigest,
        # Staff may see the balance; it is their company's.
        show_credits=True,
    )
    return envelope(report, message=_import_message(report))


@router.get("/summary", response_model=ApiEnvelope[DashboardSummaryOut])
async def dashboard_summary(
    db: Db,
    principal: CanView,
    regionId: Annotated[uuid.UUID | None, Query()] = None,
    stateId: Annotated[uuid.UUID | None, Query()] = None,
    dateFrom: Annotated[datetime.date | None, Query()] = None,
    dateTo: Annotated[datetime.date | None, Query()] = None,
) -> ApiEnvelope[DashboardSummaryOut]:
    """Every number the console's dashboard draws, in one round trip.

    Declared ABOVE `/{ticket_id}` for the reason `/escalations` is — Starlette
    matches in declaration order, and the dynamic route would otherwise swallow
    `summary` as a ticket id and answer 422.

    `jobs.view` rather than a rank floor: this is the landing page every staff
    role opens, and the figures are already narrowed to the caller's own
    territory by `scoped()`, so there is nothing here a person who may see the
    ticket list may not see counted. It carries no delta and no forecast — see
    `DashboardSummaryOut` on why a movement chip with no history behind it is
    the one thing that does not ship.

    ## The four filters narrow; none of them can widen

    `regionId` / `stateId` are the console's territory picker — a national head
    drilling from All India into a region, then a state. They need no permission
    check of their own, and deliberately have none: the pincode subquery they
    build is ANDed with `scoped()`, so naming somewhere outside your own
    territory intersects to nothing and reads zero. There is no id here that
    reveals anything, and no second rule to keep in step with the picker.

    `dateFrom` / `dateTo` are IST calendar dates, inclusive at both ends, and
    either may be given alone. They bound INTAKE — when the ticket was raised —
    because every ticket has a `created_at` and only some have a slot; bounding
    on the slot would silently drop every unbooked ticket, which is precisely
    what the "Slot not confirmed" card exists to count.
    """
    return envelope(
        await service.dashboard_summary(
            db,
            principal,
            region_id=regionId,
            state_id=stateId,
            date_from=dateFrom,
            date_to=dateTo,
        )
    )


@router.get(
    "/escalations",
    response_model=PaginatedEnvelope[TicketOut],
    dependencies=[AreaManagerUp],
)
async def list_escalations(
    db: Db,
    principal: CanAssign,
    params: Annotated[ListParams, Depends(list_params)],
    half: Annotated[str | None, Query()] = None,
    slotFrom: Annotated[datetime.date | None, Query()] = None,
    slotTo: Annotated[datetime.date | None, Query()] = None,
    regionId: Annotated[uuid.UUID | None, Query()] = None,
    stateId: Annotated[uuid.UUID | None, Query()] = None,
    dateFrom: Annotated[datetime.date | None, Query()] = None,
    dateTo: Annotated[datetime.date | None, Query()] = None,
) -> PaginatedEnvelope[TicketOut]:
    """Jobs whose slot is close and that nobody accepted, soonest first.

    Declared ABOVE `/{ticket_id}` — Starlette matches in declaration order, and
    a dynamic route sitting first would swallow this as a ticket id and answer
    422 on a valid request.

    Paged, but not for a pager: the console loads the next page on scroll, so
    every row stays reachable without a page number. The missed half only ever
    grows — see `service.list_escalations` — and it was being sent whole on
    every poll.

    `search` narrows on code, customer, phone, pincode or serial. `half` is
    `live` | `missed` and takes the console's `all` sentinel. `slotFrom` /
    `slotTo` are IST calendar dates bounding the SLOT — the day the work was
    promised, not the day the ticket was raised — inclusive at both ends, and
    either may be given alone.

    Every one of them is applied in SQL rather than in the browser, which on an
    infinite list is the only correct place: filtering the pages that happen to
    be loaded would answer "does this exist?" with "only if you have already
    scrolled far enough".
    """
    rows, total = await service.list_escalations(
        db,
        principal,
        params,
        half=half,
        slot_from=slotFrom,
        slot_to=slotTo,
        # The dashboard's four, so its "Escalations" card opens a queue holding
        # exactly what it counted. `dateFrom`/`dateTo` bound INTAKE and are a
        # different question from `slotFrom`/`slotTo` above, which bound the day
        # the work was promised — both may be set, and they compose.
        region_id=regionId,
        state_id=stateId,
        date_from=dateFrom,
        date_to=dateTo,
    )
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.post(
    "/{ticket_id}/assign",
    response_model=ApiEnvelope[TicketDetailOut],
    dependencies=[AreaManagerUp],
)
async def assign_ticket(
    ticket_id: uuid.UUID,
    db: Db,
    principal: CanAssign,
    body: AssignRequest,
) -> ApiEnvelope[TicketDetailOut]:
    """Hand the job to a named technician — §7's last resort.

    **409 says which kind of "no" it is**, and the console has to act on the
    difference: `TICKET_NOT_ASSIGNABLE`, `NO_SLOT`, `TECHNICIAN_SUSPENDED`,
    `TECHNICIAN_INELIGIBLE` (naming the pincode or the certification),
    `DAILY_CAP_REACHED`, or `ALREADY_ASSIGNED` when somebody moved the ticket
    first. A bare 409 would send a manager back to a shortlist to make the same
    unmakeable choice again.

    A technician id from another company reads 404 — a 403 would confirm they
    exist.
    """
    data = await service.assign_technician(
        db, principal, ticket_id, technician_id=body.technicianId
    )
    return envelope(data, message="Technician assigned")


@router.post(
    "/{ticket_id}/bonus",
    response_model=ApiEnvelope[RenotifyOut],
    dependencies=[AreaManagerUp],
)
async def add_bonus(
    ticket_id: uuid.UUID,
    db: Db,
    principal: CanAssign,
    body: BonusRequest,
) -> ApiEnvelope[RenotifyOut]:
    """Fund an incentive and put the job back in the pool.

    The slot the customer confirmed does not move — only who is being asked to
    take it, and for how much. `notified` in the response is how many phones
    actually rang, counted with the same predicate the push used; **zero is a
    real answer** and means no bonus can help, because nobody covers this
    pincode for this product with room on that day.

    **409 `NOT_ESCALATED`** means the job is no longer sitting unaccepted —
    almost always because somebody took it while the manager was choosing a
    band, which is the outcome everyone wanted.
    """
    data = await service.add_bonus_and_renotify(
        db, principal, ticket_id, amount_paise=body.amountPaise
    )
    return envelope(data, message="Bonus added and re-notified")


@router.post(
    "/{ticket_id}/no-show",
    response_model=ApiEnvelope[TicketDetailOut],
    dependencies=[AreaManagerUp],
)
async def record_no_show(
    ticket_id: uuid.UUID,
    db: Db,
    principal: CanAssign,
    body: NoShowRequest,
) -> ApiEnvelope[TicketDetailOut]:
    """Confirm that the technician never turned up, and charge them for it.

    The sweep finds these and deliberately charges nothing — a dead phone and a
    deliberate no-show are indistinguishable in the data, and this is the most
    expensive band there is. A person decides; this is where they say so.

    Frees the ticket and moves it to `Escalated`, because the slot has closed
    and it now needs a new time rather than a new technician.

    **409 `NOT_A_NO_SHOW`** — the job started, was cancelled, or somebody moved
    it while the manager was deciding. **409 `SLOT_STILL_OPEN`** — the window
    has not closed yet, so they are late rather than absent.
    """
    return envelope(
        await service.record_no_show(db, principal, ticket_id, note=body.note),
        message="No-show recorded",
    )


@router.post(
    "/{ticket_id}/penalties/{entry_id}/reverse",
    response_model=ApiEnvelope[TicketDetailOut],
    dependencies=[AreaManagerUp],
)
async def reverse_penalty(
    ticket_id: uuid.UUID,
    entry_id: uuid.UUID,
    db: Db,
    principal: CanReversePenalty,
    body: PenaltyReverseRequest,
) -> ApiEnvelope[TicketDetailOut]:
    """Give one penalty on this ticket back to the technician — in full.

    `entry_id` is the penalty's ledger id, from the ticket's `penalties` list: a
    ticket can carry several, one per technician who cancelled it.

    **404** — a ticket outside the caller's territory, or no such penalty on
    it. **409 `PENALTY_ALREADY_REVERSED`** — somebody got there first.
    """
    return envelope(
        await service.reverse_penalty(
            db, principal, ticket_id, entry_id, reason=body.reason
        ),
        message="Penalty reversed",
    )


#: Moving a customer's agreed time.
#:
#: Shared with the technician's own door in `jobs/router.py`, which is what makes
#: it one key rather than two: `company_role_features` overrides are per ROLE, so
#: a company that wants managers to reschedule but not technicians turns off
#: exactly one row. Two keys would have made that the same decision written
#: twice, and the pair would drift.
#:
#: Paired with the rank floor for the reason every other pairing on this screen
#: is: the grant is overridable on Feature Access, and this one changes a
#: promise already made to a customer.
CanReschedule = Annotated[Principal, Depends(require_feature("jobs.reschedule"))]


@router.get(
    "/{ticket_id}/reschedule/slots",
    response_model=ApiEnvelope[list[SlotOptionOut]],
    dependencies=[AreaManagerUp],
)
async def list_reschedule_slots(
    ticket_id: uuid.UUID, db: Db, principal: CanReschedule
) -> ApiEnvelope[list[SlotOptionOut]]:
    """Windows this ticket could be given.

    Already narrowed to what its assigned technician can serve, when it has one
    — so a manager cannot book a time the person holding it is standing in
    somebody else's kitchen for. Unassigned, it is every free window.

    Empty is a real answer and means the assigned technician's next two days are
    full; re-assigning is the way out of that, not this screen.
    """
    return envelope(await service.reschedule_options(db, principal, ticket_id))


@router.post(
    "/{ticket_id}/reschedule",
    response_model=ApiEnvelope[TicketDetailOut],
    dependencies=[AreaManagerUp],
)
async def reschedule_ticket(
    ticket_id: uuid.UUID,
    db: Db,
    principal: CanReschedule,
    body: RescheduleRequest,
) -> ApiEnvelope[TicketDetailOut]:
    """Give the job a new time, after agreeing one with the customer.

    No code, unlike the technician's door: the manager has just put the phone
    down, and a required reason is the record of that call.

    A ticket nobody holds goes back to the pool with its new time, which is how
    an escalation whose slot had passed leaves the queue for good — the case
    that queue has never had an exit for.

    **409 `ESCALATION_IS_A_REFUSAL`** means the customer said the job was NOT
    done, which needs a technician or a closure rather than a new time.
    **409 `SLOT_NO_LONGER_AVAILABLE`** means the window went while the dialog
    was open.
    """
    return envelope(
        await service.reschedule(
            db,
            principal,
            ticket_id,
            slot_start=body.slotStart,
            reason=body.reason,
        ),
        message="Time updated",
    )


@router.post(
    "/{ticket_id}/force-close",
    response_model=ApiEnvelope[TicketDetailOut],
    dependencies=[AreaManagerUp],
)
async def force_close_ticket(
    ticket_id: uuid.UUID,
    db: Db,
    principal: CanForceClose,
    body: ForceCloseRequest,
) -> ApiEnvelope[TicketDetailOut]:
    """End a job the normal closure could not finish.

    Only the customer closes a job here, which leaves one hole: a customer who
    never answers. `sweeps.sweep_force_close` finds those and raises a
    notification rather than closing anything — a system that auto-closed on
    silence would be recording an approval nobody gave. This is where a person
    takes that decision, and signs it.

    Reason, notes and at least one attachment are all required. §10 asks for
    supporting documents and a record of who closed it, when and on what basis,
    and the reason is that this is a closure the CUSTOMER never agreed to — the
    record has to stand on its own the day somebody disputes it.

    Allowed on any live ticket, not only on `Awaiting Customer`: it is the only
    exit from the live set apart from a customer confirming, so a manager who
    cannot use it here has no other tool.

    **409 `ALREADY_SETTLED`** — the ticket is already Closed, Force-Closed or
    Cancelled, including when a colleague settled it while this manager was
    filling the form in.
    """
    return envelope(
        await service.force_close_ticket(db, principal, ticket_id, body),
        message="Ticket force-closed",
    )


@router.get(
    "/{ticket_id}/attachments",
    response_model=ApiEnvelope[list[TicketAttachmentOut]],
)
async def get_ticket_attachments(
    ticket_id: uuid.UUID, db: Db, principal: CanView
) -> ApiEnvelope[list[TicketAttachmentOut]]:
    """The evidence a manager attached when force-closing this ticket.

    `jobs.view`, not `jobs.force_close`: whoever may look at the ticket may see
    why it was ended. Making the justification harder to read than the closure
    itself would defeat the point of collecting it.
    """
    return envelope(await service.list_attachments(db, principal, ticket_id))


@router.patch("/{ticket_id}/serial", response_model=ApiEnvelope[TicketDetailOut])
async def correct_ticket_serial(
    ticket_id: uuid.UUID, db: Db, principal: CanView, body: SerialCorrectionRequest
) -> ApiEnvelope[TicketDetailOut]:
    """Correct the expected serial — the number taken off the invoice.

    Whoever can see the ticket can fix it, which by the visibility rule means
    staff in its territory and the vendor that raised it. The vendor matters
    most here: the invoice is theirs, so a mistyped serial is theirs to correct.

    Only the EXPECTED serial. What the technician read on site is evidence and
    is not editable, by anyone.
    """
    return envelope(
        await service.correct_serial(
            db,
            principal,
            ticket_id,
            serial_number=body.serialNumber,
            reason=body.reason,
        ),
        message="Serial updated",
    )


@router.get("/{ticket_id}/serial-check", response_model=ApiEnvelope[SerialCheckOut])
async def check_ticket_serial(
    ticket_id: uuid.UUID,
    db: Db,
    principal: CanView,
    serial: Annotated[str, Query(min_length=1, max_length=64)],
) -> ApiEnvelope[SerialCheckOut]:
    """Would `PATCH /{ticket_id}/serial` accept this number?

    Read-only, and the same rule the PATCH runs, so the correction dialog can
    say a number will be refused while it is being typed rather than after
    Save. Same guard as the PATCH: whoever can see the ticket.
    """
    return envelope(await service.check_serial(db, principal, ticket_id, serial))


@router.get(
    "/{ticket_id}/proof", response_model=ApiEnvelope[list[TicketProofOut]]
)
async def get_ticket_proof(
    ticket_id: uuid.UUID, db: Db, principal: CanView
) -> ApiEnvelope[list[TicketProofOut]]:
    """What the technician photographed on site.

    Who sees it is decided by the same visibility rule as the ticket itself:
    staff by territory, a vendor by ownership, a vendor user only for tickets
    they raised. A technician gets 404 here — they read their own work through
    `/jobs/{id}/proof`.

    This exists because of escalation. When a customer says the job was not
    finished, the manager picking it up needs to see what was actually
    captured, and until now nothing outside the technician's own phone could.

    Links are signed and expire in minutes; re-read rather than caching them.
    """
    return envelope(await service.list_proof(db, principal, ticket_id))


@router.get("/{ticket_id}", response_model=ApiEnvelope[TicketDetailOut])
async def get_ticket(
    ticket_id: uuid.UUID, db: Db, principal: CanView
) -> ApiEnvelope[TicketDetailOut]:
    return envelope(await service.get_ticket(db, principal, ticket_id))


@router.post(
    "",
    response_model=ApiEnvelope[TicketOut],
    status_code=201,
    dependencies=[IsVendor],
)
async def create_ticket(
    body: TicketCreateRequest, db: Db, principal: CanCreate
) -> ApiEnvelope[TicketOut]:
    """Raise a ticket by hand — §4's third intake channel.

    A slot decides which status it lands in — "New" when the customer has
    already agreed a time, "Slot Pending" when they have not — but no longer
    whether technicians can see it. **Both go into the pool immediately.** A
    slotless ticket is offered while its service level runs, in parallel with
    the WhatsApp asking the customer to choose, and whoever accepts is told the
    time when it arrives.
    """
    data = await service.create_ticket(db, principal, body)
    message = (
        "Ticket created"
        if data.slotStart
        else "Ticket created — waiting for the customer to confirm a slot"
    )
    return envelope(data, message=message, status_code=201)
