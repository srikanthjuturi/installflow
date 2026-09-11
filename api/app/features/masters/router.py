"""Product master endpoints — the recursive category tree and its products.

Reads are gated on `masters.view`, writes on `masters.edit`. Every write returns
the affected ROOT branch with its whole subtree, so the console re-renders from
one authoritative response instead of patching a local tree and hoping it
matches — which matters more now that a change at any depth can move an
inherited icon, an inherited parameter or a technician count several levels
below it.

`/categories` and `/subcategories` were two halves of the same idea and are now
one `/nodes`. A node's level is `depth`, not which URL created it.

## Four audiences, four guards

    masters.view                 read the tree. Held by every staff role AND by
                                 vendors, whose intake form needs a picker.
    masters.edit + staff-only    the ops writes below. The rank is not the
                                 point; the ROLE is — see `IsStaff`.
    masters.approve + NH floor   price a submission, or refuse it.
    vendor.catalogue + vendor    a vendor's own submissions, under /portal.

Neither of the two new keys is `masters.edit`, and hard rule 2 says why: "a key
that already exists is not automatically the right key." `masters.edit` gates
PUT and DELETE on every node and every model in the tenant, so granting it to a
vendor would let them rename or delete a COMPETITOR's products; and approving
spends money, so it is paired with a rank floor no per-company override can lift.
"""

import uuid
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
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
    require_feature,
    require_min_rank,
    require_staff_principal,
    require_vendor_principal,
)
from app.core.icons import PRODUCT_ICON_KEYS
from app.core.schemas import (
    ApiEnvelope,
    ListParams,
    PaginatedEnvelope,
    envelope,
    list_params,
    paginated,
)
from app.features.masters import service
from app.features.masters.schemas import (
    ApprovalRequest,
    BrandApprovalOut,
    ModelCreateRequest,
    ModelUpdateRequest,
    NodeCreateRequest,
    NodePortalUpdateRequest,
    NodeUpdateRequest,
    ProductApprovalOut,
    ProductModelSerialOut,
    ProductNodeOut,
    ProductResubmitRequest,
    ProductSubmitRequest,
    RejectionRequest,
    SerialAddRequest,
    SerialAddResult,
    SerialImportReport,
    SerialMatchOut,
    SerialUpdateRequest,
)
from app.models.role import NATIONAL_HEAD

router = APIRouter(prefix="/masters", tags=["masters"])

Db = Annotated[AsyncSession, Depends(get_db)]
CanView = Annotated[Principal, Depends(require_feature("masters.view"))]
CanEdit = Annotated[Principal, Depends(require_feature("masters.edit"))]
CanApprove = Annotated[Principal, Depends(require_feature("masters.approve"))]
CanContribute = Annotated[Principal, Depends(require_feature("vendor.catalogue"))]

#: Paired with `masters.approve` because a feature grant is overridable per
#: company on Feature Access, and pricing a product decides what every ticket
#: ever raised against it is worth. Same pairing `vendors/router.py` uses, and
#: the reason hard rule 2 gives for `jobs.force_close`.
#:
#: It also excludes vendors (rank 6/7) and technicians (5) for free, which is
#: why these three routes need no `require_staff_principal` of their own.
NationalHeadUp = Depends(require_min_rank(NATIONAL_HEAD))

#: On every ops WRITE below, and it closes a real gap rather than restating the
#: feature grant. `service._validate_vendor` proves a `vendorId` in a body names
#: a live vendor IN THE CALLER'S COMPANY; it never proves it names the caller's
#: OWN vendor, and nothing else on that path does either. So a vendor handed
#: `masters.edit` through Feature Access — one toggle, and "let the vendor add
#: products" is exactly the intent under which somebody would tick it — could
#: brand a model to a competitor.
#:
#: It costs nothing on the day it ships: no staff role is excluded, and no
#: vendor holds `masters.edit` today. It is the mirror of the guard
#: `POST /tickets` already carries, and it is what makes the vendor path below
#: the ONLY way a vendor writes here.
IsStaff = Depends(require_staff_principal)

IsVendor = Depends(require_vendor_principal)


@router.get("/icons", response_model=ApiEnvelope[list[str]])
async def list_icons(principal: CanView) -> ApiEnvelope[list[str]]:
    """The icon keys a category may use.

    The catalogue is code on all three surfaces; this endpoint exists so the
    console can render the picker in catalogue order without duplicating the
    ordering, not so the set can change at runtime.
    """
    return envelope(list(PRODUCT_ICON_KEYS))


@router.get("/nodes", response_model=ApiEnvelope[list[ProductNodeOut]])
async def get_nodes(
    db: Db,
    principal: CanView,
    includeInactive: Annotated[bool, Query()] = False,
    vendorId: Annotated[uuid.UUID | None, Query()] = None,
    purpose: Annotated[
        str, Query(pattern="(?i)^(catalogue|intake)$")
    ] = "catalogue",
) -> ApiEnvelope[list[ProductNodeOut]]:
    """The catalogue, whole or narrowed to one brand. Roots, nested downward.

    NOT staff-only, deliberately — a vendor calls this every time they open the
    intake form, and `get_tree` substitutes their own vendor id for whatever
    `vendorId` asked for.

    `vendorId` returns only that vendor's models. `purpose=intake` additionally
    hides products nobody has approved and prunes the branches that leaves
    empty, so a picker never offers a path that dead-ends. See
    `core.product_tree.TREE_PURPOSES` for why that is one parameter and not two.

    The pattern is case-insensitive because this rides in a shareable query
    string, and an older bookmark carrying `?purpose=Intake` must not 422 a
    whole screen.
    """
    data = await service.get_tree(
        db,
        principal,
        include_inactive=includeInactive,
        vendor_id=vendorId,
        purpose=purpose.lower(),
    )
    return envelope(data)


# ── the ops writes ────────────────────────────────────────────────────────────


@router.post(
    "/nodes",
    response_model=ApiEnvelope[ProductNodeOut],
    status_code=201,
    dependencies=[IsStaff],
)
async def create_node(
    body: NodeCreateRequest, db: Db, principal: CanEdit
) -> ApiEnvelope[ProductNodeOut]:
    """Add a category. `parentId` omitted makes it a root."""
    data = await service.create_node(db, principal, body)
    return envelope(data, message="Category added", status_code=201)


@router.put(
    "/nodes/{node_id}",
    response_model=ApiEnvelope[ProductNodeOut],
    dependencies=[IsStaff],
)
async def update_node(
    node_id: uuid.UUID, body: NodeUpdateRequest, db: Db, principal: CanEdit
) -> ApiEnvelope[ProductNodeOut]:
    """Rename, re-icon, pause or re-field a category.

    Deliberately cannot move it: `NodeUpdateRequest` has no `parentId`, because
    `ancestor_ids` is derived at create time and a move would mean rewriting the
    whole subtree.
    """
    data = await service.update_node(db, principal, node_id, body)
    return envelope(data, message="Category updated")


@router.delete(
    "/nodes/{node_id}", response_model=ApiEnvelope[None], dependencies=[IsStaff]
)
async def delete_node(
    node_id: uuid.UUID, db: Db, principal: CanEdit
) -> ApiEnvelope[None]:
    await service.delete_node(db, principal, node_id)
    return envelope(None, message="Category removed")


@router.post(
    "/nodes/{node_id}/models",
    response_model=ApiEnvelope[ProductNodeOut],
    status_code=201,
    dependencies=[IsStaff],
)
async def create_model(
    node_id: uuid.UUID, body: ModelCreateRequest, db: Db, principal: CanEdit
) -> ApiEnvelope[ProductNodeOut]:
    data = await service.create_model(db, principal, node_id, body)
    return envelope(data, message="Product model added", status_code=201)


@router.put(
    "/models/{model_id}",
    response_model=ApiEnvelope[ProductNodeOut],
    dependencies=[IsStaff],
)
async def update_model(
    model_id: uuid.UUID, body: ModelUpdateRequest, db: Db, principal: CanEdit
) -> ApiEnvelope[ProductNodeOut]:
    data = await service.update_model(db, principal, model_id, body)
    return envelope(data, message="Product model updated")


@router.delete(
    "/models/{model_id}", response_model=ApiEnvelope[None], dependencies=[IsStaff]
)
async def delete_model(
    model_id: uuid.UUID, db: Db, principal: CanEdit
) -> ApiEnvelope[None]:
    await service.delete_model(db, principal, model_id)
    return envelope(None, message="Product model removed")


# ── model-wise serial numbers ─────────────────────────────────────────────────
#
# The serials a model covers, checked at ticket intake by
# `tickets._assert_serial_known`. Staff writes, on the same `masters.edit` +
# `IsStaff` pairing as everything above — a vendor could reasonably be the party
# that loads these, since it holds the invoice, but nothing is blocked while
# staff catch up (an unloaded model is simply unchecked) so that stayed a
# deliberate follow-up rather than an assumption.
#
# The template route sits at `/serials/template` rather than under `/models/…`
# so it cannot be read as a model id under any future route.


@router.get("/serials/template")
async def serial_template(principal: CanView) -> StreamingResponse:
    """A starter .xlsx with the one header the importer reads.

    On `masters.view` and NOT staff-only: a vendor loading serials onto its own
    products needs the same starter file, and the file carries no data at all —
    one header row and two example serials, identical for every caller. Gating
    it harder than the tree it accompanies would only mean a vendor guessing at
    the column name.
    """
    return StreamingResponse(
        service.build_serial_template(),
        media_type=(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ),
        headers={
            "Content-Disposition": 'attachment; filename="serial-numbers.xlsx"'
        },
    )


@router.get(
    "/serials/lookup", response_model=ApiEnvelope[list[SerialMatchOut]]
)
async def lookup_serial(
    db: Db,
    principal: CanView,
    serial: Annotated[str, Query(min_length=1, max_length=64)],
    offset: Annotated[int, Query(ge=0, le=10_000)] = 0,
) -> ApiEnvelope[list[SerialMatchOut]]:
    """Serials STARTING WITH `serial`, each with the product it names.

    Feeds the intake form's suggestion dropdown, and through it the autofill.
    A prefix search: an exact-only lookup answered nothing until the last
    character landed, so the box stayed silent through the whole of the typing
    and read as broken. What the form DOES with the answer still turns on
    exactness — it fills only when the typed value equals one of these outright
    — but that is the client's decision, not this endpoint's.

    On `masters.view`, which vendors hold so their intake form has a product
    tree. That is the point: the caller is the vendor reading the number off the
    unit in front of them.

    One page of `MAX_SERIAL_MATCHES`, ordered by serial then model id — a total
    order, so paging neither repeats nor skips. `offset` walks further in, which
    is what lets the dropdown scroll instead of stopping at the cap. Under
    `MIN_SERIAL_QUERY` characters it answers nothing — `SN-` matches most of a
    catalogue.

    A short page means the end: the client stops asking when it gets back fewer
    than it asked for, so there is no total to compute and no second query to
    count one.

    Empty is the normal answer, not an error: most serials are simply not
    loaded, and a 404 here would make the form's ordinary state look broken.

    ⚠ `service.lookup_serial` pins a vendor to its OWN models. Without that this
    endpoint is an oracle — and prefix matching makes that EASIER, not harder,
    since a vendor could walk a competitor's numbering scheme three characters
    at a time and read their catalogue back, in one request and without raising
    anything.
    """
    matches = await service.lookup_serial(db, principal, serial, offset=offset)
    exact = [m for m in matches if m.serial.lower() == serial.strip().lower()]
    return envelope(
        matches,
        message=(
            f"{exact[0].modelName} matched"
            if len(exact) == 1
            else f"{len(matches)} matching serial(s)"
            if matches
            else "No serial starts with that"
        ),
    )


@router.get(
    "/models/{model_id}/serials",
    response_model=PaginatedEnvelope[ProductModelSerialOut],
)
async def list_serials(
    model_id: uuid.UUID,
    db: Db,
    principal: CanView,
    params: Annotated[ListParams, Depends(list_params)],
) -> PaginatedEnvelope[ProductModelSerialOut]:
    """One page of a model's serials, newest first. `?search=` narrows.

    On `masters.view` rather than `masters.edit`: this is the tree's own read
    guard, and a manager who can see a product can see which units it covers.
    The model is resolved company-scoped first, so a guessed id is a 404.
    """
    rows, total = await service.list_serials(db, principal, model_id, params)
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.post(
    "/models/{model_id}/serials",
    response_model=ApiEnvelope[SerialAddResult],
    status_code=201,
    dependencies=[IsStaff],
)
async def add_serials(
    model_id: uuid.UUID, body: SerialAddRequest, db: Db, principal: CanEdit
) -> ApiEnvelope[SerialAddResult]:
    """Add serials typed or pasted into the console.

    Takes a list, not one value: the console's box accepts a pasted block, which
    is how somebody adds twenty without reaching for a spreadsheet. Serials the
    model already holds are reported in `duplicates`, never refused.
    """
    data = await service.add_serials(db, principal, model_id, body)
    return envelope(
        data,
        message=(
            f"{data.added} serial number{'' if data.added == 1 else 's'} added"
            if data.added
            else "Already on this model — nothing to add"
        ),
        status_code=201,
    )


@router.put(
    "/models/{model_id}/serials/{serial_id}",
    response_model=ApiEnvelope[ProductModelSerialOut],
    dependencies=[IsStaff],
)
async def update_serial(
    model_id: uuid.UUID,
    serial_id: uuid.UUID,
    body: SerialUpdateRequest,
    db: Db,
    principal: CanEdit,
) -> ApiEnvelope[ProductModelSerialOut]:
    """Correct one serial in place, keeping who loaded it and when."""
    data = await service.update_serial(
        db, principal, model_id, serial_id, body.serial
    )
    return envelope(data, message="Serial number updated")


@router.delete(
    "/models/{model_id}/serials/{serial_id}",
    response_model=ApiEnvelope[int],
    dependencies=[IsStaff],
)
async def delete_serial(
    model_id: uuid.UUID, serial_id: uuid.UUID, db: Db, principal: CanEdit
) -> ApiEnvelope[int]:
    """Remove one serial, and answer with what the model holds afterwards.

    ⚠ Removing the LAST serial turns intake checking off for this model, because
    empty means unchecked. The console says so before it lets the count reach
    zero; the count in this response is what it reads to know.
    """
    total = await service.delete_serial(db, principal, model_id, serial_id)
    return envelope(total, message="Serial number removed")


@router.post(
    "/models/{model_id}/serials/import",
    response_model=ApiEnvelope[SerialImportReport],
    dependencies=[IsStaff],
)
async def import_serials(
    model_id: uuid.UUID,
    db: Db,
    principal: CanEdit,
    file: Annotated[UploadFile, File()],
    dryRun: Annotated[bool, Query()] = True,
) -> ApiEnvelope[SerialImportReport]:
    """Load a model's serials from a spreadsheet. `dryRun` writes nothing.

    Additive: it adds what the file names and never removes what the file omits,
    for the reason geography's importer does not either — a half-finished upload
    must not silently empty a model and turn its intake check off.
    """
    name = (file.filename or "").lower()
    if not name.endswith((".xlsx", ".csv")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Upload an .xlsx or .csv file",
        )

    # Read with a ceiling rather than trusting the declared size: a client can
    # claim any content-length, and the body would otherwise be in memory before
    # any check that came after it. Lifted verbatim from `geo.import_geography`.
    data = await file.read(service.MAX_SERIAL_UPLOAD_BYTES + 1)
    if len(data) > service.MAX_SERIAL_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                "The file must be under "
                f"{service.MAX_SERIAL_UPLOAD_BYTES // (1024 * 1024)} MB"
            ),
        )

    report = await service.import_serials(
        db, principal, model_id, data, name, dry_run=dryRun
    )
    return envelope(
        report,
        message=(
            "Checked — nothing was saved"
            if dryRun
            else f"{report.added} serial number{'' if report.added == 1 else 's'} added"
        ),
    )


# ── approvals ─────────────────────────────────────────────────────────────────
#
# Declared BEFORE `/models/{model_id}` would matter if they shared a prefix;
# they do not (`/approvals` is its own segment), but the approve and reject
# routes deliberately sit under `/models/{id}/…` so the id in the path is the
# same id every other model route takes.


@router.get(
    "/approvals",
    response_model=PaginatedEnvelope[ProductApprovalOut],
    dependencies=[NationalHeadUp],
)
async def list_approvals(
    db: Db,
    principal: CanApprove,
    params: Annotated[ListParams, Depends(list_params)],
    status: Annotated[str | None, Query()] = None,
) -> PaginatedEnvelope[ProductApprovalOut]:
    """Products a vendor submitted, newest problem first.

    `status` defaults to `pending` — the queue's job is the backlog. `all`
    widens it; anything unrecognised yields an empty page rather than a 422,
    because these filters ride in a shareable query string.
    """
    rows, total = await service.list_approvals(
        db, principal, params, status_filter=status
    )
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.get(
    "/approvals/count",
    response_model=ApiEnvelope[int],
    dependencies=[NationalHeadUp],
)
async def pending_approvals(db: Db, principal: CanApprove) -> ApiEnvelope[int]:
    """How many are waiting. The console's rail badge.

    Its own endpoint rather than the queue's first page: the rail renders on
    every screen, and "how many are waiting" is a TOTAL — twenty rows cannot say
    there are twenty-three. Same reasoning as `/notifications/unread`.
    """
    return envelope(await service.pending_count(db, principal))


@router.post(
    "/models/{model_id}/approve",
    response_model=ApiEnvelope[ProductApprovalOut],
    dependencies=[NationalHeadUp],
)
async def approve_model(
    model_id: uuid.UUID, body: ApprovalRequest, db: Db, principal: CanApprove
) -> ApiEnvelope[ProductApprovalOut]:
    """Set both prices and let tickets be raised against it."""
    data = await service.approve_model(db, principal, model_id, body)
    return envelope(data, message="Product approved")


@router.post(
    "/models/{model_id}/reject",
    response_model=ApiEnvelope[ProductApprovalOut],
    dependencies=[NationalHeadUp],
)
async def reject_model(
    model_id: uuid.UUID, body: RejectionRequest, db: Db, principal: CanApprove
) -> ApiEnvelope[ProductApprovalOut]:
    """Refuse it, with a reason the vendor reads and can act on."""
    data = await service.reject_model(db, principal, model_id, body)
    return envelope(data, message="Product rejected")


# ── brand approvals ───────────────────────────────────────────────────────────
#
# The brands a vendor named in its portal, decided by the same people under the
# same two guards as its products. `/approvals/count` above already includes
# them — one rail badge for one person's queue.


@router.get(
    "/brand-approvals",
    response_model=PaginatedEnvelope[BrandApprovalOut],
    dependencies=[NationalHeadUp],
)
async def list_brand_approvals(
    db: Db,
    principal: CanApprove,
    params: Annotated[ListParams, Depends(list_params)],
    status: Annotated[str | None, Query()] = None,
) -> PaginatedEnvelope[BrandApprovalOut]:
    """Brands vendors added, longest wait first. `status` behaves as it does on `/approvals`."""
    rows, total = await service.list_brand_approvals(
        db, principal, params, status_filter=status
    )
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.post(
    "/brands/{brand_id}/approve",
    response_model=ApiEnvelope[BrandApprovalOut],
    dependencies=[NationalHeadUp],
)
async def approve_brand(
    brand_id: uuid.UUID, db: Db, principal: CanApprove
) -> ApiEnvelope[BrandApprovalOut]:
    """Agree the vendor sells this brand. No body — there is nothing to price."""
    data = await service.approve_brand(db, principal, brand_id)
    return envelope(data, message="Brand approved")


@router.post(
    "/brands/{brand_id}/reject",
    response_model=ApiEnvelope[BrandApprovalOut],
    dependencies=[NationalHeadUp],
)
async def reject_brand(
    brand_id: uuid.UUID, body: RejectionRequest, db: Db, principal: CanApprove
) -> ApiEnvelope[BrandApprovalOut]:
    """Refuse it, with a reason the vendor reads and can act on."""
    data = await service.reject_brand(db, principal, brand_id, body)
    return envelope(data, message="Brand rejected")


# ── a vendor's own catalogue ──────────────────────────────────────────────────
#
# Their own paths rather than a branch in the writes above, because a route
# carries ONE feature dependency and the bodies are different shapes — see the
# argument in `service.py` above `submit_model`.


@router.post(
    "/portal/nodes",
    response_model=ApiEnvelope[ProductNodeOut],
    status_code=201,
    dependencies=[IsVendor],
)
async def submit_node(
    body: NodeCreateRequest, db: Db, principal: CanContribute
) -> ApiEnvelope[ProductNodeOut]:
    """A vendor adds a category.

    Straight into the STAFF writer, and that asymmetry with `submit_model` below
    is the point: a category has no vendor dimension, no prices and no approval
    state, so there is nothing to pin and nothing to branch. The only difference
    between the two callers is the guard on the route.

    A category is company-wide, so this one is not reviewed. An empty one offers
    nothing at intake and `purpose=intake` prunes it out of every picker, so the
    worst case is a row on the ops Categories screen that an admin removes. The
    vendor can edit it afterwards (`PUT /portal/nodes/{id}`) because it created
    it — `created_by` is what records that.
    """
    data = await service.create_node(db, principal, body)
    return envelope(data, message="Category added", status_code=201)


@router.put(
    "/portal/nodes/{node_id}",
    response_model=ApiEnvelope[ProductNodeOut],
    dependencies=[IsVendor],
)
async def update_own_node(
    node_id: uuid.UUID,
    body: NodePortalUpdateRequest,
    db: Db,
    principal: CanContribute,
) -> ApiEnvelope[ProductNodeOut]:
    """A vendor edits a category it CREATED. Not reviewed, same as the create.

    Only its own: a category is company-wide, so one somebody else added — staff
    or another brand — is a 404 here, the way another vendor's product is. No
    DELETE twin; removing a category stays with staff.
    """
    data = await service.update_own_node(db, principal, node_id, body)
    return envelope(data, message="Category updated")


@router.post(
    "/portal/nodes/{node_id}/models",
    response_model=ApiEnvelope[ProductNodeOut],
    status_code=201,
    dependencies=[IsVendor],
)
async def submit_model(
    node_id: uuid.UUID, body: ProductSubmitRequest, db: Db, principal: CanContribute
) -> ApiEnvelope[ProductNodeOut]:
    """A vendor submits a product. Unpriced, pending, and not yet ticketable."""
    data = await service.submit_model(db, principal, node_id, body)
    return envelope(data, message="Product sent for approval", status_code=201)


@router.put(
    "/portal/models/{model_id}",
    response_model=ApiEnvelope[ProductNodeOut],
    dependencies=[IsVendor],
)
async def update_own_model(
    model_id: uuid.UUID,
    body: ProductResubmitRequest,
    db: Db,
    principal: CanContribute,
) -> ApiEnvelope[ProductNodeOut]:
    """Edit an own product. Approved stays approved; a rejected one resubmits."""
    data = await service.update_own_model(db, principal, model_id, body)
    return envelope(data, message="Product saved")


@router.delete(
    "/portal/models/{model_id}",
    response_model=ApiEnvelope[None],
    dependencies=[IsVendor],
)
async def delete_own_model(
    model_id: uuid.UUID, db: Db, principal: CanContribute
) -> ApiEnvelope[None]:
    await service.delete_own_model(db, principal, model_id)
    return envelope(None, message="Product removed")


# ── a vendor's own serial numbers ─────────────────────────────────────────────
#
# Full control of its OWN products' serials: add, import, correct, remove. Every
# one is pinned by `_serial_target(own_only=True)` → `_load_own_model`, so
# another vendor's model is a 404 rather than a refusal.
#
# ⚠ This was ADD-ONLY when it shipped, on the reasoning that removing the last
# serial turns intake checking OFF for a model — so delete lets a vendor lift
# its own gate, which add never can. That was raised and the call was made to
# hand it over anyway: the vendor holds the invoice, and a vendor who cannot fix
# its own typo has to ring somebody to correct a number only it can read.
#
# What survives the decision is the WARNING, not a refusal. Removing the last
# serial is confirmed in those words in both clients, and `update_serial` exists
# so correcting a typo does not have to go through a delete at all.


@router.post(
    "/portal/models/{model_id}/serials",
    response_model=ApiEnvelope[SerialAddResult],
    status_code=201,
    dependencies=[IsVendor],
)
async def add_own_serials(
    model_id: uuid.UUID,
    body: SerialAddRequest,
    db: Db,
    principal: CanContribute,
) -> ApiEnvelope[SerialAddResult]:
    """A vendor loads serials onto its OWN product.

    The vendor holds the invoice, which is the same fact that makes the expected
    serial mandatory at intake — so it is the party that actually knows these
    numbers.

    `own_only=True` routes the lookup through `_load_own_model`, so another
    vendor's model is a 404 and not merely a refusal.
    """
    data = await service.add_serials(db, principal, model_id, body, own_only=True)
    return envelope(
        data,
        message=(
            f"{data.added} serial number{'' if data.added == 1 else 's'} added"
            if data.added
            else "Already on this product — nothing to add"
        ),
        status_code=201,
    )


@router.post(
    "/portal/models/{model_id}/serials/import",
    response_model=ApiEnvelope[SerialImportReport],
    dependencies=[IsVendor],
)
async def import_own_serials(
    model_id: uuid.UUID,
    db: Db,
    principal: CanContribute,
    file: Annotated[UploadFile, File()],
    dryRun: Annotated[bool, Query()] = True,
) -> ApiEnvelope[SerialImportReport]:
    """The same spreadsheet import, for a vendor's own product.

    Additive like the ops one, which is what makes it safe to expose here: an
    import can only ever add, so no upload — half-finished or not — can empty a
    model and turn its intake check off.
    """
    name = (file.filename or "").lower()
    if not name.endswith((".xlsx", ".csv")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Upload an .xlsx or .csv file",
        )
    data = await file.read(service.MAX_SERIAL_UPLOAD_BYTES + 1)
    if len(data) > service.MAX_SERIAL_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                "The file must be under "
                f"{service.MAX_SERIAL_UPLOAD_BYTES // (1024 * 1024)} MB"
            ),
        )

    report = await service.import_serials(
        db, principal, model_id, data, name, dry_run=dryRun, own_only=True
    )
    return envelope(
        report,
        message=(
            "Checked — nothing was saved"
            if dryRun
            else f"{report.added} serial number{'' if report.added == 1 else 's'} added"
        ),
    )


@router.put(
    "/portal/models/{model_id}/serials/{serial_id}",
    response_model=ApiEnvelope[ProductModelSerialOut],
    dependencies=[IsVendor],
)
async def update_own_serial(
    model_id: uuid.UUID,
    serial_id: uuid.UUID,
    body: SerialUpdateRequest,
    db: Db,
    principal: CanContribute,
) -> ApiEnvelope[ProductModelSerialOut]:
    """A vendor corrects one of its own serials, in place.

    The reason this exists rather than leaving "edit" to a delete and a re-add:
    the row keeps `created_at` and `created_by`, so fixing a typo does not
    rewrite the record of who loaded that unit — and it never passes through a
    moment where the model has one fewer serial than it should.
    """
    data = await service.update_serial(
        db, principal, model_id, serial_id, body.serial, own_only=True
    )
    return envelope(data, message="Serial number updated")


@router.delete(
    "/portal/models/{model_id}/serials/{serial_id}",
    response_model=ApiEnvelope[int],
    dependencies=[IsVendor],
)
async def delete_own_serial(
    model_id: uuid.UUID, serial_id: uuid.UUID, db: Db, principal: CanContribute
) -> ApiEnvelope[int]:
    """Remove one of a vendor's own serials, and answer with what is left.

    ⚠ Removing the LAST one turns intake checking off for this product — this
    vendor's own gate. Not refused, deliberately: an empty model is the state
    every model ships in, and a vendor that cannot remove a wrong number would
    have to ring somebody to correct a serial only it can read. The count in
    this response is what the portal uses to warn before it happens.
    """
    total = await service.delete_serial(
        db, principal, model_id, serial_id, own_only=True
    )
    return envelope(total, message="Serial number removed")
