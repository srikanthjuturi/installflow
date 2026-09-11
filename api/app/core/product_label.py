"""What a product model is called where two of a vendor's brands could share its name.

A vendor may sell several brands, and model names are unique per BRAND, so two
brands can each have a "43 inch LED" in one category. Wherever a model is named
without the rest of its row — a technician's job card — the bare name can then
point at two different units.

The console's ticket form applies the same rule (`modelLabel` in
`adminWeb/src/components/tickets/ManualEntryForm.tsx`); keep the two in step.
"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.product import ProductModel


def model_label(name: str, brand_name: str | None, several_brands: bool) -> str:
    """The model's name, with its brand in front only where that tells two apart.

    Only when the vendor has products under more than one brand — so a vendor
    selling under one, which is every vendor from before brands existed, reads
    exactly as it always did — and only when the name does not already start
    with the brand, which most do ("Meridian 43"…"), so it is never said twice.
    """
    if not several_brands or not brand_name:
        return name
    if name.casefold().startswith(brand_name.casefold()):
        return name
    return f"{brand_name} · {name}"


async def vendors_with_several_brands(
    db: AsyncSession, vendor_ids: set[uuid.UUID]
) -> set[uuid.UUID]:
    """The vendors among these whose live products span more than one brand.

    Counted over PRODUCTS, not over approved brands: a second brand with nothing
    filed under it yet cannot make two job cards ambiguous, and should not change
    how the first brand's products are named. One grouped query.
    """
    if not vendor_ids:
        return set()
    rows = await db.execute(
        select(ProductModel.vendor_id)
        .where(
            ProductModel.vendor_id.in_(vendor_ids),
            ProductModel.deleted_at.is_(None),
        )
        .group_by(ProductModel.vendor_id)
        .having(func.count(func.distinct(ProductModel.brand_id)) > 1)
    )
    return {vendor_id for (vendor_id,) in rows}
