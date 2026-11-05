"""Vendor SKU on products (quickstart Scenario 2).

A SKU is the vendor's own code for a product, unique within the vendor ignoring
case, settable in the console, the vendor portal and the product import. Run with:

    cd api
    DB_POOL_SIZE=4 DB_MAX_OVERFLOW=2 .venv/Scripts/python.exe -m pytest tests/integration/test_vendor_sku.py -v
"""

import asyncio
import io
import sys
import uuid

import pytest

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy import select  # noqa: E402

from app.core.database import AsyncSessionLocal  # noqa: E402
from app.core.errors import AppError  # noqa: E402
from app.features.masters import import_service, service  # noqa: E402
from app.features.masters.schemas import (  # noqa: E402
    ModelCreateRequest,
    ModelUpdateRequest,
    ProductResubmitRequest,
    ProductSubmitRequest,
)
from app.models.product import ProductModel  # noqa: E402
from tests.integration import test_task05_acceptance as t05  # noqa: E402


def _unique(prefix: str = "SKU") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8].upper()}"


async def _sku_of(db, model_id: uuid.UUID) -> str | None:
    return await db.scalar(
        select(ProductModel.sku)
        .where(ProductModel.id == model_id)
        .execution_options(populate_existing=True)
    )


async def _new_model(db, admin, w, *, sku: str | None, name: str | None = None) -> uuid.UUID:
    brand = await db.scalar(select(ProductModel.brand_id).where(ProductModel.id == w.model_id))
    name = name or f"SKU test {uuid.uuid4().hex[:6]}"
    await service.create_model(
        db,
        admin,
        w.leaf_id,
        ModelCreateRequest(
            name=name,
            vendorId=w.vendor_id,
            brandId=brand,
            technicianPayoutPaise=10_000,
            vendorPricePaise=20_000,
            sku=sku,
        ),
    )
    return await db.scalar(
        select(ProductModel.id).where(
            ProductModel.node_id == w.leaf_id, ProductModel.name == name
        )
    )


async def _drop(db, admin, *model_ids: uuid.UUID) -> None:
    for model_id in model_ids:
        try:
            await service.delete_model(db, admin, model_id)
        except Exception:  # noqa: BLE001 — hygiene only
            await db.rollback()


def _xlsx(rows: list[list[str]]) -> bytes:
    import openpyxl

    book = openpyxl.Workbook()
    sheet = book.active
    for row in rows:
        sheet.append(row)
    out = io.BytesIO()
    book.save(out)
    return out.getvalue()


def test_sku_rules_in_the_console() -> None:
    w = t05.world()

    async def go() -> None:
        async with AsyncSessionLocal() as db:
            admin = await t05.p(db, "admin")
            sku = _unique("WP")
            first = await _new_model(db, admin, w, sku=f"  {sku.lower()}  ")
            second = await _new_model(db, admin, w, sku=None)
            made: list[uuid.UUID] = [first, second]
            try:
                # trimmed on the way in
                assert await _sku_of(db, first) == sku.lower()
                # a product with no SKU reads as none, never blank
                assert await _sku_of(db, second) is None

                # a clash in a different case is refused, naming the holder
                with pytest.raises(AppError) as err:
                    await service.update_model(
                        db, admin, second, ModelUpdateRequest(sku=sku.upper())
                    )
                assert err.value.code == "SKU_TAKEN" and err.value.status_code == 409
                assert await _sku_of(db, second) is None

                # and on create
                with pytest.raises(AppError) as err2:
                    await _new_model(db, admin, w, sku=sku.upper())
                assert err2.value.code == "SKU_TAKEN"

                # saving the SAME product with its own SKU is not a clash
                await service.update_model(db, admin, first, ModelUpdateRequest(sku=sku))
                assert await _sku_of(db, first) == sku

                # blank clears it, and that frees it for another product
                await service.update_model(db, admin, first, ModelUpdateRequest(sku="   "))
                assert await _sku_of(db, first) is None
                await service.update_model(db, admin, second, ModelUpdateRequest(sku=sku))
                assert await _sku_of(db, second) == sku

                # a deleted product frees its SKU
                await service.delete_model(db, admin, second)
                made.remove(second)
                third = await _new_model(db, admin, w, sku=sku)
                made.append(third)
                assert await _sku_of(db, third) == sku
            finally:
                await _drop(db, admin, *made)

    asyncio.run(go())


def test_sku_through_the_vendor_portal() -> None:
    w = t05.world()

    async def go() -> None:
        async with AsyncSessionLocal() as db:
            admin = await t05.p(db, "admin")
            vendor = await t05.p(db, "vendor")
            sku = _unique("PORTAL")
            held = await _new_model(db, admin, w, sku=sku)
            made = [held]
            try:
                brand = await db.scalar(
                    select(ProductModel.brand_id).where(ProductModel.id == w.model_id)
                )
                # a vendor submitting a product with a taken SKU is refused
                with pytest.raises(AppError) as err:
                    await service.submit_model(
                        db,
                        vendor,
                        w.leaf_id,
                        ProductSubmitRequest(
                            name=f"Portal {uuid.uuid4().hex[:6]}", brandId=brand, sku=sku.lower()
                        ),
                    )
                assert err.value.code == "SKU_TAKEN"

                # a free one is accepted, and editing it to a taken one is refused
                free = _unique("FREE")
                name = f"Portal {uuid.uuid4().hex[:6]}"
                await service.submit_model(
                    db, vendor, w.leaf_id, ProductSubmitRequest(name=name, brandId=brand, sku=free)
                )
                mine = await db.scalar(
                    select(ProductModel.id).where(
                        ProductModel.node_id == w.leaf_id, ProductModel.name == name
                    )
                )
                made.append(mine)
                assert await _sku_of(db, mine) == free
                with pytest.raises(AppError) as err2:
                    await service.update_own_model(
                        db, vendor, mine, ProductResubmitRequest(sku=sku)
                    )
                assert err2.value.code == "SKU_TAKEN"
                await service.update_own_model(
                    db, vendor, mine, ProductResubmitRequest(sku=_unique("NEW"))
                )
            finally:
                await _drop(db, admin, *made)

    asyncio.run(go())


def test_sku_in_the_product_import() -> None:
    w = t05.world()

    async def go() -> None:
        async with AsyncSessionLocal() as db:
            admin = await t05.p(db, "admin")
            taken = _unique("HELD")
            held = await _new_model(db, admin, w, sku=taken)
            made = [held]
            try:
                category = await db.scalar(
                    select(ProductModel.node_id).where(ProductModel.id == w.model_id)
                )
                from app.models.product import ProductNode

                chain = await db.scalar(select(ProductNode.name).where(ProductNode.id == category))
                brand_name = None
                from app.models.vendor_brand import VendorBrand

                brand_id = await db.scalar(
                    select(ProductModel.brand_id).where(ProductModel.id == w.model_id)
                )
                brand_name = await db.scalar(
                    select(VendorBrand.name).where(VendorBrand.id == brand_id)
                )
                parents = await db.scalar(
                    select(ProductNode.ancestor_ids).where(ProductNode.id == category)
                )
                names = []
                for pid in parents or []:
                    names.append(await db.scalar(select(ProductNode.name).where(ProductNode.id == pid)))
                names.append(f"{chain}(islastsubcategory)")
                category_cell = ", ".join(names)

                fresh = _unique("NEWSKU")
                a, b = f"Import A {uuid.uuid4().hex[:5]}", f"Import B {uuid.uuid4().hex[:5]}"
                header = ["Category", "Brand", "Product Name", "SKU", "Technician Payout (paise)", "Vendor Price (paise)"]
                data = _xlsx(
                    [
                        header,
                        [category_cell, brand_name, a, fresh, "10000", "20000"],
                        [category_cell, brand_name, b, taken.lower(), "10000", "20000"],
                        [category_cell, brand_name, f"Import C {uuid.uuid4().hex[:5]}", fresh.lower(), "10000", "20000"],
                    ]
                )
                report = await import_service.import_products(
                    db, admin, data, "skus.xlsx", vendor_id=w.vendor_id, is_staff=True, dry_run=False
                )
                codes = sorted(r.code for r in report.rejects)
                # the second row clashes with a saved SKU, the third repeats the first's in the file
                assert codes == ["SKU_DUPLICATE_IN_FILE", "SKU_TAKEN"], codes
                assert report.created == 1
                ids = list(
                    await db.scalars(
                        select(ProductModel.id).where(
                            ProductModel.node_id == category, ProductModel.name.in_([a, b])
                        )
                    )
                )
                made.extend(ids)
                assert len(ids) == 1 and await _sku_of(db, ids[0]) == fresh
            finally:
                await _drop(db, admin, *made)

    asyncio.run(go())
