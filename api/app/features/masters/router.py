"""Product master endpoints — the recursive category tree and its products.

Reads are gated on `masters.view`, writes on `masters.edit`. Every write returns
the affected ROOT branch with its whole subtree, so the console re-renders from
one authoritative response instead of patching a local tree and hoping it
matches — which matters more now that a change at any depth can move an
inherited icon, an inherited parameter or a technician count several levels
below it.

`/categories` and `/subcategories` were two halves of the same idea and are now
one `/nodes`. A node's level is `depth`, not which URL created it.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import Principal, require_feature
from app.core.icons import PRODUCT_ICON_KEYS
from app.core.schemas import ApiEnvelope, envelope
from app.features.masters import service
from app.features.masters.schemas import (
    ModelCreateRequest,
    ModelUpdateRequest,
    NodeCreateRequest,
    NodeUpdateRequest,
    ProductNodeOut,
)

router = APIRouter(prefix="/masters", tags=["masters"])

Db = Annotated[AsyncSession, Depends(get_db)]
CanView = Annotated[Principal, Depends(require_feature("masters.view"))]
CanEdit = Annotated[Principal, Depends(require_feature("masters.edit"))]


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
) -> ApiEnvelope[list[ProductNodeOut]]:
    """The catalogue, whole or narrowed to one brand. Roots, nested downward.

    `vendorId` returns only that vendor's models, and only the branches left
    holding any — ticket intake picks a vendor first, and the pickers under it
    must not offer a path that dead-ends.
    """
    data = await service.get_tree(
        db, principal, include_inactive=includeInactive, vendor_id=vendorId
    )
    return envelope(data)


@router.post("/nodes", response_model=ApiEnvelope[ProductNodeOut], status_code=201)
async def create_node(
    body: NodeCreateRequest, db: Db, principal: CanEdit
) -> ApiEnvelope[ProductNodeOut]:
    """Add a category. `parentId` omitted makes it a root."""
    data = await service.create_node(db, principal, body)
    return envelope(data, message="Category added", status_code=201)


@router.put("/nodes/{node_id}", response_model=ApiEnvelope[ProductNodeOut])
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


@router.delete("/nodes/{node_id}", response_model=ApiEnvelope[None])
async def delete_node(
    node_id: uuid.UUID, db: Db, principal: CanEdit
) -> ApiEnvelope[None]:
    await service.delete_node(db, principal, node_id)
    return envelope(None, message="Category removed")


@router.post(
    "/nodes/{node_id}/models",
    response_model=ApiEnvelope[ProductNodeOut],
    status_code=201,
)
async def create_model(
    node_id: uuid.UUID, body: ModelCreateRequest, db: Db, principal: CanEdit
) -> ApiEnvelope[ProductNodeOut]:
    data = await service.create_model(db, principal, node_id, body)
    return envelope(data, message="Product model added", status_code=201)


@router.put("/models/{model_id}", response_model=ApiEnvelope[ProductNodeOut])
async def update_model(
    model_id: uuid.UUID, body: ModelUpdateRequest, db: Db, principal: CanEdit
) -> ApiEnvelope[ProductNodeOut]:
    data = await service.update_model(db, principal, model_id, body)
    return envelope(data, message="Product model updated")


@router.delete("/models/{model_id}", response_model=ApiEnvelope[None])
async def delete_model(
    model_id: uuid.UUID, db: Db, principal: CanEdit
) -> ApiEnvelope[None]:
    await service.delete_model(db, principal, model_id)
    return envelope(None, message="Product model removed")
