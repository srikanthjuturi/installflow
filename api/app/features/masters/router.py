"""Product master endpoints — the category → subcategory → model catalogue.

Reads are gated on `masters.view`, writes on `masters.edit`. Every write returns
the affected category with its whole subtree, so the console re-renders from one
authoritative response instead of patching a local tree and hoping it matches.
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
    CategoryCreateRequest,
    CategoryUpdateRequest,
    ModelCreateRequest,
    ModelUpdateRequest,
    ProductCategoryOut,
    SubcategoryCreateRequest,
    SubcategoryUpdateRequest,
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


@router.get("/categories", response_model=ApiEnvelope[list[ProductCategoryOut]])
async def get_categories(
    db: Db,
    principal: CanView,
    includeInactive: Annotated[bool, Query()] = False,
    vendorId: Annotated[uuid.UUID | None, Query()] = None,
) -> ApiEnvelope[list[ProductCategoryOut]]:
    """The catalogue, whole or narrowed to one brand.

    `vendorId` returns only that vendor's models, and only the subcategories and
    categories left holding any — ticket intake picks a vendor first, and the
    pickers under it must not offer a path that dead-ends.
    """
    data = await service.get_tree(
        db, principal, include_inactive=includeInactive, vendor_id=vendorId
    )
    return envelope(data)


@router.post(
    "/categories", response_model=ApiEnvelope[ProductCategoryOut], status_code=201
)
async def create_category(
    body: CategoryCreateRequest, db: Db, principal: CanEdit
) -> ApiEnvelope[ProductCategoryOut]:
    data = await service.create_category(db, principal, body)
    return envelope(data, message="Category added", status_code=201)


@router.put("/categories/{category_id}", response_model=ApiEnvelope[ProductCategoryOut])
async def update_category(
    category_id: uuid.UUID, body: CategoryUpdateRequest, db: Db, principal: CanEdit
) -> ApiEnvelope[ProductCategoryOut]:
    data = await service.update_category(db, principal, category_id, body)
    return envelope(data, message="Category updated")


@router.delete("/categories/{category_id}", response_model=ApiEnvelope[None])
async def delete_category(
    category_id: uuid.UUID, db: Db, principal: CanEdit
) -> ApiEnvelope[None]:
    await service.delete_category(db, principal, category_id)
    return envelope(None, message="Category removed")


@router.post(
    "/categories/{category_id}/subcategories",
    response_model=ApiEnvelope[ProductCategoryOut],
    status_code=201,
)
async def create_subcategory(
    category_id: uuid.UUID, body: SubcategoryCreateRequest, db: Db, principal: CanEdit
) -> ApiEnvelope[ProductCategoryOut]:
    data = await service.create_subcategory(db, principal, category_id, body)
    return envelope(data, message="Subcategory added", status_code=201)


@router.put(
    "/subcategories/{subcategory_id}", response_model=ApiEnvelope[ProductCategoryOut]
)
async def update_subcategory(
    subcategory_id: uuid.UUID,
    body: SubcategoryUpdateRequest,
    db: Db,
    principal: CanEdit,
) -> ApiEnvelope[ProductCategoryOut]:
    data = await service.update_subcategory(db, principal, subcategory_id, body)
    return envelope(data, message="Subcategory updated")


@router.delete("/subcategories/{subcategory_id}", response_model=ApiEnvelope[None])
async def delete_subcategory(
    subcategory_id: uuid.UUID, db: Db, principal: CanEdit
) -> ApiEnvelope[None]:
    await service.delete_subcategory(db, principal, subcategory_id)
    return envelope(None, message="Subcategory removed")


@router.post(
    "/subcategories/{subcategory_id}/models",
    response_model=ApiEnvelope[ProductCategoryOut],
    status_code=201,
)
async def create_model(
    subcategory_id: uuid.UUID, body: ModelCreateRequest, db: Db, principal: CanEdit
) -> ApiEnvelope[ProductCategoryOut]:
    data = await service.create_model(db, principal, subcategory_id, body)
    return envelope(data, message="Product model added", status_code=201)


@router.put("/models/{model_id}", response_model=ApiEnvelope[ProductCategoryOut])
async def update_model(
    model_id: uuid.UUID, body: ModelUpdateRequest, db: Db, principal: CanEdit
) -> ApiEnvelope[ProductCategoryOut]:
    data = await service.update_model(db, principal, model_id, body)
    return envelope(data, message="Product model updated")


@router.delete("/models/{model_id}", response_model=ApiEnvelope[None])
async def delete_model(
    model_id: uuid.UUID, db: Db, principal: CanEdit
) -> ApiEnvelope[None]:
    await service.delete_model(db, principal, model_id)
    return envelope(None, message="Product model removed")
