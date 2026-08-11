"""Idempotent product-catalogue seed.

    python -m app.scripts.seed_catalogue

Gives every company that has no categories yet the starter catalogue: the two
groupings the ops team asked for, the six product types both apps already
hardcode, and their models.

This is a script rather than a migration because the catalogue is tenant data —
migrations seed global reference data only (roles, features, regions). A company
that has edited its catalogue is skipped entirely, so this is safe to re-run.
"""

import asyncio
import sys
import warnings

if sys.platform == "win32":
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy import func, select  # noqa: E402

from app.core.database import AsyncSessionLocal  # noqa: E402
from app.models import Company  # noqa: E402
from app.models.product import (  # noqa: E402
    ProductCategory,
    ProductModel,
    ProductSubcategory,
)

# (category, icon, [(subcategory, icon, [(model, capacity, warranty_months)])])
#
# The six subcategories are exactly what `mobileapp/src/mocks/db.ts` and
# `adminWeb/src/services/mocks/masters.ts` already hardcode — including Water
# Purifier, which mobile had and the console did not. Seeding both from one
# place is what stops the two drifting again.
#
# The model names are kept verbatim from the approved prototype, so the demo
# path still reads as designed — which means the size appears twice for these
# rows, once in the name and once in `capacity`. That duplication is the point
# of the column: a model added from now on splits them properly, and these can
# be tidied without touching anything that references them by id.
Models = list[tuple[str, str | None, int | None]]
CATALOGUE: list[tuple[str, str, list[tuple[str, str, Models]]]] = [
    (
        "Electric",
        "zap",
        [
            (
                "Television",
                "tv",
                [
                    ('43" 4K UHD', "43 inch", 24),
                    ('55" QLED', "55 inch", 24),
                    ('50" 4K', "50 inch", 24),
                    ('32" HD', "32 inch", 12),
                    ('40" FHD', "40 inch", 12),
                ],
            ),
            (
                "Air Conditioner",
                "air-vent",
                [
                    ("1.5T Inverter Split", "1.5 ton", 60),
                    ("1T Window AC", "1 ton", 12),
                    ("2T Cassette", "2 ton", 60),
                ],
            ),
        ],
    ),
    (
        "Home Appliance",
        "refrigerator",
        [
            (
                "Washing Machine",
                "washing-machine",
                [
                    ("7kg Front Load", "7 kg", 24),
                    ("6.5kg Top Load", "6.5 kg", 24),
                    ("8kg Front Load", "8 kg", 24),
                ],
            ),
            (
                "Refrigerator",
                "refrigerator",
                [
                    ("340L Frost-Free", "340 L", 120),
                    ("253L Direct Cool", "253 L", 120),
                    ("470L Side-by-Side", "470 L", 120),
                ],
            ),
            (
                "Microwave",
                "microwave",
                [
                    ("28L Convection", "28 L", 12),
                    ("20L Solo", "20 L", 12),
                    ("30L Grill", "30 L", 12),
                ],
            ),
            (
                "Water Purifier",
                "droplets",
                [("RO 8L", "8 L", 12), ("UV + UF 7L", "7 L", 12)],
            ),
        ],
    ),
]


async def seed() -> None:
    async with AsyncSessionLocal() as session:
        companies = list(
            await session.scalars(
                select(Company).where(Company.deleted_at.is_(None))
            )
        )
        if not companies:
            print("No companies yet — create one, then re-run.")
            return

        for company in companies:
            existing = await session.scalar(
                select(func.count(ProductCategory.id)).where(
                    ProductCategory.company_id == company.id,
                    ProductCategory.deleted_at.is_(None),
                )
            )
            if existing:
                print(f"{company.name}: {existing} categories already — skipped")
                continue

            for c_order, (cat_name, cat_icon, subs) in enumerate(CATALOGUE, start=1):
                category = ProductCategory(
                    company_id=company.id,
                    name=cat_name,
                    icon_key=cat_icon,
                    sort_order=c_order,
                    is_active=True,
                )
                session.add(category)
                await session.flush()

                for s_order, (sub_name, sub_icon, models) in enumerate(subs, start=1):
                    subcategory = ProductSubcategory(
                        company_id=company.id,
                        category_id=category.id,
                        name=sub_name,
                        icon_key=sub_icon,
                        sort_order=s_order,
                        is_active=True,
                    )
                    session.add(subcategory)
                    await session.flush()

                    for m_order, (name, capacity, warranty) in enumerate(
                        models, start=1
                    ):
                        session.add(
                            ProductModel(
                                company_id=company.id,
                                subcategory_id=subcategory.id,
                                name=name,
                                capacity=capacity,
                                warranty_months=warranty,
                                sort_order=m_order,
                                is_active=True,
                            )
                        )

            await session.commit()
            subs_count = sum(len(s) for _, _, s in CATALOGUE)
            print(f"{company.name}: seeded {len(CATALOGUE)} categories, {subs_count} subcategories")


if __name__ == "__main__":
    asyncio.run(seed())
