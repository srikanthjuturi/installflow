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

from fastapi import APIRouter, Depends, Query
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
    ModelCreateRequest,
    ModelUpdateRequest,
    NodeCreateRequest,
    NodeUpdateRequest,
    ProductApprovalOut,
    ProductNodeOut,
    ProductResubmitRequest,
    ProductSubmitRequest,
    RejectionRequest,
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
    worst case is a row on the ops Categories screen that an admin removes.
    """
    data = await service.create_node(db, principal, body)
    return envelope(data, message="Category added", status_code=201)


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
    """Edit an own product. Any real change sends it back for approval."""
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
