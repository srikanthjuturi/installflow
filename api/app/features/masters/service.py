"""Product master service — category → subcategory → model, company-scoped.

Every read and write is filtered by `principal.company_id` and `deleted_at IS
NULL`. There is no territory scoping: a product catalogue is company-wide, not
regional, so an area manager sees the same list a national head does.

Deletes are soft and refuse to orphan: a category with live subcategories, or a
subcategory with live models, is a 409 rather than a cascade. The message names
what is in the way, because "cannot delete" without a reason sends the user
hunting.
"""

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Principal
from app.core.icons import DEFAULT_ICON_KEY
from app.features.masters.schemas import (
    CategoryCreateRequest,
    CategoryUpdateRequest,
    ModelCreateRequest,
    ModelUpdateRequest,
    ProductCategoryOut,
    ProductModelOut,
    ProductSubcategoryOut,
    SubcategoryCreateRequest,
    SubcategoryUpdateRequest,
)
from app.models.product import ProductCategory, ProductModel, ProductSubcategory
from app.models.technician import TechnicianSubcategory
from app.models.vendor import Vendor


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _not_found(what: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{what} not found")


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


# ── loaders ───────────────────────────────────────────────────────────────────


async def _load_category(
    db: AsyncSession, company_id: uuid.UUID, category_id: uuid.UUID
) -> ProductCategory:
    row = await db.scalar(
        select(ProductCategory).where(
            ProductCategory.id == category_id,
            ProductCategory.company_id == company_id,
            ProductCategory.deleted_at.is_(None),
        )
    )
    if row is None:
        raise _not_found("Category")
    return row


async def _load_subcategory(
    db: AsyncSession, company_id: uuid.UUID, subcategory_id: uuid.UUID
) -> ProductSubcategory:
    row = await db.scalar(
        select(ProductSubcategory).where(
            ProductSubcategory.id == subcategory_id,
            ProductSubcategory.company_id == company_id,
            ProductSubcategory.deleted_at.is_(None),
        )
    )
    if row is None:
        raise _not_found("Subcategory")
    return row


async def _load_model(
    db: AsyncSession, company_id: uuid.UUID, model_id: uuid.UUID
) -> ProductModel:
    row = await db.scalar(
        select(ProductModel).where(
            ProductModel.id == model_id,
            ProductModel.company_id == company_id,
            ProductModel.deleted_at.is_(None),
        )
    )
    if row is None:
        raise _not_found("Product model")
    return row


# ── helpers ───────────────────────────────────────────────────────────────────


async def _next_sort(db: AsyncSession, stmt) -> int:
    current = await db.scalar(stmt)
    return int(current or 0) + 1


async def _assert_category_name_free(
    db: AsyncSession,
    company_id: uuid.UUID,
    name: str,
    *,
    exclude_id: uuid.UUID | None = None,
) -> None:
    stmt = select(ProductCategory.id).where(
        ProductCategory.company_id == company_id,
        ProductCategory.deleted_at.is_(None),
        func.lower(ProductCategory.name) == name.lower(),
    )
    if exclude_id is not None:
        stmt = stmt.where(ProductCategory.id != exclude_id)
    if await db.scalar(stmt) is not None:
        raise _conflict(f"A category called {name} already exists")


async def _assert_subcategory_name_free(
    db: AsyncSession,
    category_id: uuid.UUID,
    name: str,
    *,
    exclude_id: uuid.UUID | None = None,
) -> None:
    stmt = select(ProductSubcategory.id).where(
        ProductSubcategory.category_id == category_id,
        ProductSubcategory.deleted_at.is_(None),
        func.lower(ProductSubcategory.name) == name.lower(),
    )
    if exclude_id is not None:
        stmt = stmt.where(ProductSubcategory.id != exclude_id)
    if await db.scalar(stmt) is not None:
        raise _conflict(f"This category already has a subcategory called {name}")


async def _assert_model_name_free(
    db: AsyncSession,
    subcategory_id: uuid.UUID,
    name: str,
    *,
    exclude_id: uuid.UUID | None = None,
) -> None:
    stmt = select(ProductModel.id).where(
        ProductModel.subcategory_id == subcategory_id,
        ProductModel.deleted_at.is_(None),
        func.lower(ProductModel.name) == name.lower(),
    )
    if exclude_id is not None:
        stmt = stmt.where(ProductModel.id != exclude_id)
    if await db.scalar(stmt) is not None:
        raise _conflict(f"This subcategory already has a model called {name}")


async def _validate_vendor(
    db: AsyncSession, company_id: uuid.UUID, vendor_id: uuid.UUID
) -> uuid.UUID:
    """Resolve a client-supplied vendor id inside the caller's own company.

    A scoped query, not a bare load: the id arrives in a request body, which
    makes it an assertion rather than a fact. Cross-company ids and paused
    vendors both fail here, so the composite FK never has to be the thing that
    catches them.

    This queries the Vendor MODEL directly rather than calling the vendors
    service — hard rule 4 forbids one slice importing another's service, while
    sharing models across slices is normal (technicians reads ProductSubcategory
    the same way).
    """
    found = await db.scalar(
        select(Vendor.id).where(
            Vendor.id == vendor_id,
            Vendor.company_id == company_id,
            Vendor.is_active.is_(True),
            Vendor.deleted_at.is_(None),
        )
    )
    if found is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unknown or inactive vendor",
        )
    return found


async def subcategory_ids_for_company(
    db: AsyncSession, company_id: uuid.UUID, ids: list[uuid.UUID]
) -> list[uuid.UUID]:
    """The subset of `ids` that are live, active subcategories of this company.

    Shared with the technicians slice, which validates certifications against it.
    """
    if not ids:
        return []
    rows = await db.scalars(
        select(ProductSubcategory.id).where(
            ProductSubcategory.id.in_(ids),
            ProductSubcategory.company_id == company_id,
            ProductSubcategory.is_active.is_(True),
            ProductSubcategory.deleted_at.is_(None),
        )
    )
    return list(rows)


# ── read ──────────────────────────────────────────────────────────────────────


async def get_tree(
    db: AsyncSession, principal: Principal, *, include_inactive: bool = False
) -> list[ProductCategoryOut]:
    """The whole catalogue in one response.

    Three flat queries assembled in Python rather than a nested eager load: the
    catalogue is small (tens of rows), and it feeds the technician form, ticket
    intake and the mobile coverage screen, where a second round trip on a field
    connection costs more than the join would have.
    """
    company_id = principal.company_id

    cat_stmt = select(ProductCategory).where(
        ProductCategory.company_id == company_id,
        ProductCategory.deleted_at.is_(None),
    )
    sub_stmt = select(ProductSubcategory).where(
        ProductSubcategory.company_id == company_id,
        ProductSubcategory.deleted_at.is_(None),
    )
    model_stmt = select(ProductModel).where(
        ProductModel.company_id == company_id,
        ProductModel.deleted_at.is_(None),
    )
    if not include_inactive:
        cat_stmt = cat_stmt.where(ProductCategory.is_active.is_(True))
        sub_stmt = sub_stmt.where(ProductSubcategory.is_active.is_(True))
        model_stmt = model_stmt.where(ProductModel.is_active.is_(True))

    categories = list(
        await db.scalars(cat_stmt.order_by(ProductCategory.sort_order, ProductCategory.name))
    )
    subcategories = list(
        await db.scalars(
            sub_stmt.order_by(ProductSubcategory.sort_order, ProductSubcategory.name)
        )
    )
    models = list(
        await db.scalars(model_stmt.order_by(ProductModel.sort_order, ProductModel.name))
    )

    # One extra query for the brand names, joined in Python like everything else
    # here. Not filtered to the models on hand: the catalogue is tens of rows and
    # this keeps a removed-but-still-referenced vendor resolvable.
    vendor_rows = await db.execute(
        select(Vendor.id, Vendor.name).where(Vendor.company_id == company_id)
    )
    vendor_names = {vendor_id: name for vendor_id, name in vendor_rows}

    models_by_sub: dict[uuid.UUID, list[ProductModelOut]] = {}
    for m in models:
        models_by_sub.setdefault(m.subcategory_id, []).append(
            ProductModelOut(
                id=m.id,
                subcategoryId=m.subcategory_id,
                vendorId=m.vendor_id,
                vendorName=vendor_names.get(m.vendor_id, ""),
                name=m.name,
                serviceTypes=list(m.service_types or []),
                capacity=m.capacity,
                warrantyMonths=m.warranty_months,
                imageUrls=list(m.image_urls or []),
                isActive=m.is_active,
                sortOrder=m.sort_order,
            )
        )

    counts = await _technician_counts(db, [s.id for s in subcategories])
    icon_of_category = {c.id: c.icon_key for c in categories}

    subs_by_cat: dict[uuid.UUID, list[ProductSubcategoryOut]] = {}
    for s in subcategories:
        subs_by_cat.setdefault(s.category_id, []).append(
            ProductSubcategoryOut(
                id=s.id,
                categoryId=s.category_id,
                name=s.name,
                # Resolved here, once, so no client walks the tree to draw a tile.
                iconKey=s.icon_key
                or icon_of_category.get(s.category_id, DEFAULT_ICON_KEY),
                ownIconKey=s.icon_key,
                isActive=s.is_active,
                sortOrder=s.sort_order,
                technicianCount=counts.get(s.id, 0),
                models=models_by_sub.get(s.id, []),
            )
        )

    return [
        ProductCategoryOut(
            id=c.id,
            name=c.name,
            iconKey=c.icon_key,
            isActive=c.is_active,
            sortOrder=c.sort_order,
            subcategories=subs_by_cat.get(c.id, []),
        )
        for c in categories
    ]


async def _technician_counts(
    db: AsyncSession, subcategory_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    """How many technicians are certified per subcategory.

    A real count. The console shows this number ("34 technicians certified"),
    and it is exactly the kind of figure that quietly stays seed data forever if
    nobody wires it.
    """
    if not subcategory_ids:
        return {}
    rows = await db.execute(
        select(
            TechnicianSubcategory.subcategory_id, func.count(TechnicianSubcategory.id)
        )
        .where(TechnicianSubcategory.subcategory_id.in_(subcategory_ids))
        .group_by(TechnicianSubcategory.subcategory_id)
    )
    return {sub_id: count for sub_id, count in rows}


async def _one_category(
    db: AsyncSession, principal: Principal, category_id: uuid.UUID
) -> ProductCategoryOut:
    """Re-read a single category as the client will see it, subtree included."""
    tree = await get_tree(db, principal, include_inactive=True)
    for node in tree:
        if node.id == category_id:
            return node
    raise _not_found("Category")


# ── categories ────────────────────────────────────────────────────────────────


async def create_category(
    db: AsyncSession, principal: Principal, body: CategoryCreateRequest
) -> ProductCategoryOut:
    company_id = principal.company_id
    name = body.name.strip()
    await _assert_category_name_free(db, company_id, name)

    sort_order = await _next_sort(
        db,
        select(func.max(ProductCategory.sort_order)).where(
            ProductCategory.company_id == company_id,
            ProductCategory.deleted_at.is_(None),
        ),
    )
    row = ProductCategory(
        company_id=company_id,
        name=name,
        icon_key=body.iconKey,
        is_active=body.isActive,
        sort_order=sort_order,
        created_by=principal.user_id,
    )
    db.add(row)
    await db.commit()
    return await _one_category(db, principal, row.id)


async def update_category(
    db: AsyncSession,
    principal: Principal,
    category_id: uuid.UUID,
    body: CategoryUpdateRequest,
) -> ProductCategoryOut:
    row = await _load_category(db, principal.company_id, category_id)

    if body.name is not None:
        name = body.name.strip()
        await _assert_category_name_free(
            db, principal.company_id, name, exclude_id=category_id
        )
        row.name = name
    if body.iconKey is not None:
        row.icon_key = body.iconKey
    if body.isActive is not None:
        row.is_active = body.isActive
    if body.sortOrder is not None:
        row.sort_order = body.sortOrder
    row.updated_by = principal.user_id

    await db.commit()
    return await _one_category(db, principal, category_id)


async def delete_category(
    db: AsyncSession, principal: Principal, category_id: uuid.UUID
) -> None:
    row = await _load_category(db, principal.company_id, category_id)

    live = await db.scalar(
        select(func.count(ProductSubcategory.id)).where(
            ProductSubcategory.category_id == category_id,
            ProductSubcategory.deleted_at.is_(None),
        )
    )
    if live:
        raise _conflict(
            f"{row.name} still has {live} subcategor"
            f"{'y' if live == 1 else 'ies'}. Remove them first."
        )

    row.deleted_at = _now()
    row.is_active = False
    row.updated_by = principal.user_id
    await db.commit()


# ── subcategories ─────────────────────────────────────────────────────────────


async def create_subcategory(
    db: AsyncSession,
    principal: Principal,
    category_id: uuid.UUID,
    body: SubcategoryCreateRequest,
) -> ProductCategoryOut:
    await _load_category(db, principal.company_id, category_id)
    name = body.name.strip()
    await _assert_subcategory_name_free(db, category_id, name)

    sort_order = await _next_sort(
        db,
        select(func.max(ProductSubcategory.sort_order)).where(
            ProductSubcategory.category_id == category_id,
            ProductSubcategory.deleted_at.is_(None),
        ),
    )
    db.add(
        ProductSubcategory(
            company_id=principal.company_id,
            category_id=category_id,
            name=name,
            icon_key=body.iconKey,
            is_active=body.isActive,
            sort_order=sort_order,
            created_by=principal.user_id,
        )
    )
    await db.commit()
    return await _one_category(db, principal, category_id)


async def update_subcategory(
    db: AsyncSession,
    principal: Principal,
    subcategory_id: uuid.UUID,
    body: SubcategoryUpdateRequest,
) -> ProductCategoryOut:
    row = await _load_subcategory(db, principal.company_id, subcategory_id)

    if body.name is not None:
        name = body.name.strip()
        await _assert_subcategory_name_free(
            db, row.category_id, name, exclude_id=subcategory_id
        )
        row.name = name
    # An explicit null resets the icon to "inherit the parent", so this reads
    # the payload rather than testing for None.
    if "iconKey" in body.model_fields_set:
        row.icon_key = body.iconKey
    if body.isActive is not None:
        row.is_active = body.isActive
    if body.sortOrder is not None:
        row.sort_order = body.sortOrder
    row.updated_by = principal.user_id

    await db.commit()
    return await _one_category(db, principal, row.category_id)


async def delete_subcategory(
    db: AsyncSession, principal: Principal, subcategory_id: uuid.UUID
) -> None:
    row = await _load_subcategory(db, principal.company_id, subcategory_id)

    live_models = await db.scalar(
        select(func.count(ProductModel.id)).where(
            ProductModel.subcategory_id == subcategory_id,
            ProductModel.deleted_at.is_(None),
        )
    )
    if live_models:
        raise _conflict(
            f"{row.name} still has {live_models} product model"
            f"{'' if live_models == 1 else 's'}. Remove them first."
        )

    certified = (await _technician_counts(db, [subcategory_id])).get(subcategory_id, 0)
    if certified:
        raise _conflict(
            f"{certified} technician{'' if certified == 1 else 's'} "
            f"{'is' if certified == 1 else 'are'} certified for {row.name}. "
            "Move them to another subcategory first."
        )

    row.deleted_at = _now()
    row.is_active = False
    row.updated_by = principal.user_id
    await db.commit()


# ── models ────────────────────────────────────────────────────────────────────


async def create_model(
    db: AsyncSession,
    principal: Principal,
    subcategory_id: uuid.UUID,
    body: ModelCreateRequest,
) -> ProductCategoryOut:
    parent = await _load_subcategory(db, principal.company_id, subcategory_id)
    name = body.name.strip()
    await _assert_model_name_free(db, subcategory_id, name)
    await _validate_vendor(db, principal.company_id, body.vendorId)

    sort_order = await _next_sort(
        db,
        select(func.max(ProductModel.sort_order)).where(
            ProductModel.subcategory_id == subcategory_id,
            ProductModel.deleted_at.is_(None),
        ),
    )
    db.add(
        ProductModel(
            company_id=principal.company_id,
            subcategory_id=subcategory_id,
            vendor_id=body.vendorId,
            name=name,
            service_types=list(body.serviceTypes),
            capacity=(body.capacity or "").strip() or None,
            warranty_months=body.warrantyMonths,
            image_urls=list(body.imageUrls),
            is_active=body.isActive,
            sort_order=sort_order,
            created_by=principal.user_id,
        )
    )
    await db.commit()
    return await _one_category(db, principal, parent.category_id)


async def update_model(
    db: AsyncSession,
    principal: Principal,
    model_id: uuid.UUID,
    body: ModelUpdateRequest,
) -> ProductCategoryOut:
    row = await _load_model(db, principal.company_id, model_id)
    parent = await _load_subcategory(db, principal.company_id, row.subcategory_id)

    if body.name is not None:
        name = body.name.strip()
        await _assert_model_name_free(db, row.subcategory_id, name, exclude_id=model_id)
        row.name = name
    if body.vendorId is not None:
        await _validate_vendor(db, principal.company_id, body.vendorId)
        row.vendor_id = body.vendorId
    if body.serviceTypes is not None:
        # A new list, not a mutation: SQLAlchemy does not track JSONB in place.
        row.service_types = list(body.serviceTypes)
    # These three can be CLEARED, so they test presence in the payload rather
    # than "is not None" — an explicit null has to mean "remove it", which the
    # other fields' test would read as "leave it alone".
    if "imageUrls" in body.model_fields_set:
        # A new list, not a mutation: SQLAlchemy does not track JSONB in place.
        row.image_urls = list(body.imageUrls or [])
    if "capacity" in body.model_fields_set:
        row.capacity = (body.capacity or "").strip() or None
    if "warrantyMonths" in body.model_fields_set:
        row.warranty_months = body.warrantyMonths
    if body.isActive is not None:
        row.is_active = body.isActive
    if body.sortOrder is not None:
        row.sort_order = body.sortOrder
    row.updated_by = principal.user_id

    await db.commit()
    return await _one_category(db, principal, parent.category_id)


async def delete_model(
    db: AsyncSession, principal: Principal, model_id: uuid.UUID
) -> None:
    row = await _load_model(db, principal.company_id, model_id)
    row.deleted_at = _now()
    row.is_active = False
    row.updated_by = principal.user_id
    await db.commit()
