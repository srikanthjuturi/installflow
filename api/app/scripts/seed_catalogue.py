"""Idempotent vendor and product-catalogue seed.

    python -m app.scripts.seed_catalogue

Gives every company its starter vendors and its starter catalogue: the two
groupings the ops team asked for, the six product types both apps already
hardcode, and their models, each branded with one of the seeded vendors.

Idempotent LEVEL BY LEVEL, not all-or-nothing. Anything already present under
its parent — matched by name, case-insensitively — is left exactly as it is, and
only what is missing gets added. That is what lets this repair the state the
`vendor_id` migration leaves behind, where the categories and subcategories
survive but every model was deleted for want of a brand.

A soft-deleted row counts as present. Somebody removing a starter category meant
it, and a seeder that puts it back on every run is a seeder people stop running.

This is a script rather than a migration because both vendors and the catalogue
are tenant data — migrations seed global reference data only (roles, features,
regions).
"""

import asyncio
import sys
import warnings
from itertools import cycle

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
from app.models.vendor import Vendor  # noqa: E402

# (name, gst_number, cin, contact_person, phone, address, city, state, pincode,
#  intake_channels)
#
# Placeholder statutory numbers, but FORMAT-VALID ones: the seed writes through
# the ORM and so bypasses the Pydantic types, and a row that cannot survive its
# own edit form is a trap for whoever opens it first.
#
# The channel mix is deliberate. None is "API", even for the vendors the
# prototype showed as API integrations — that channel is not selectable yet
# (app/core/intake.py), and seeding a value the edit form would refuse to save
# back is exactly the trap described above. Two vendors carry BOTH channels, so
# the multi-select is exercised the moment anyone opens the screen.
VENDORS: list[tuple[str, str, str, str, str, str, str, str, str, list[str]]] = [
    (
        "Videocon Industries",
        "27AAACV1234A1Z5",
        "L32100MH1985PLC123456",
        "Rakesh Mehta",
        "+919820011001",
        "Videocon House, 14th Floor, Chakala, Andheri East",
        "Mumbai",
        "Maharashtra",
        "400099",
        ["Excel", "Manual"],
    ),
    (
        "Samsung India Electronics",
        "09AAACS2345B1Z6",
        "U32201UP1995PTC123457",
        "Priya Nair",
        "+919820011002",
        "6th Floor, DLF Centre, Sector 62",
        "Noida",
        "Uttar Pradesh",
        "201301",
        ["Excel"],
    ),
    (
        "LG Electronics India",
        "07AAACL3456C1Z7",
        "U32107DL1997PTC123458",
        "Arun Sharma",
        "+919820011003",
        "Plot 51, Surajpur Kasna Road, Udyog Vihar",
        "New Delhi",
        "Delhi",
        "110044",
        ["Excel"],
    ),
    (
        "Whirlpool of India",
        "27AAACW4567D1Z8",
        "L29191MH1960PLC123459",
        "Sneha Kulkarni",
        "+919820011004",
        "Plot 40, Sector 44, Whitefield Industrial Area",
        "Pune",
        "Maharashtra",
        "411014",
        ["Manual"],
    ),
    (
        "Voltas Limited",
        "27AAACT5678E1Z9",
        "L29308MH1954PLC123460",
        "Imran Qureshi",
        "+919820011005",
        "Voltas House A, Dr Babasaheb Ambedkar Road, Chinchpokli",
        "Mumbai",
        "Maharashtra",
        "400033",
        ["Excel", "Manual"],
    ),
    (
        "Godrej Appliances",
        "27AAACG6789F1Z1",
        "U28100MH1988PTC123461",
        "Deepa Iyer",
        "+919820011006",
        "Pirojshanagar, Eastern Express Highway, Vikhroli",
        "Mumbai",
        "Maharashtra",
        "400079",
        ["Manual"],
    ),
]

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


async def _find(session, model, company_id, name_column, name: str, *extra):
    """The row of `model` with this name, INCLUDING soft-deleted ones.

    Soft-deleted rows count as "exists" on purpose. Somebody removing a starter
    category meant it, and a seeder that puts it back every time it runs is a
    seeder people stop running.
    """
    return await session.scalar(
        select(model).where(
            model.company_id == company_id,
            func.lower(name_column) == name.lower(),
            *extra,
        )
    )


async def _seed_vendors(session, company) -> list:
    """Ensure this company has vendors; return their ids in name order.

    Guarded independently of the catalogue: vendors arrived later than the
    product master, so a company that already has an edited catalogue still
    needs its brands. Returns the existing ids untouched when there are any.
    """
    existing = list(
        await session.scalars(
            select(Vendor.id)
            .where(Vendor.company_id == company.id, Vendor.deleted_at.is_(None))
            .order_by(Vendor.name)
        )
    )
    if existing:
        print(f"{company.name}: {len(existing)} vendors already — skipped")
        return existing

    for (
        name,
        gst,
        cin,
        contact,
        phone,
        address,
        city,
        state,
        pincode,
        channels,
    ) in VENDORS:
        session.add(
            Vendor(
                company_id=company.id,
                name=name,
                gst_number=gst,
                cin=cin,
                contact_person=contact,
                phone=phone,
                address=address,
                city=city,
                state=state,
                pincode=pincode,
                # A copy per company — the literal above is shared, and a JSONB
                # column handed the same list object twice is a bug waiting.
                intake_channels=list(channels),
                is_active=True,
            )
        )
    # Committed here, not left pending: a company whose catalogue already exists
    # takes the `continue` below and never reaches the catalogue commit, so a
    # bare flush would lose its vendors.
    await session.commit()
    print(f"{company.name}: seeded {len(VENDORS)} vendors")

    return list(
        await session.scalars(
            select(Vendor.id)
            .where(Vendor.company_id == company.id, Vendor.deleted_at.is_(None))
            .order_by(Vendor.name)
        )
    )


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
            vendor_ids = await _seed_vendors(session, company)

            # Round-robin rather than random: "any brand" was the instruction,
            # but a seed that differs between two developers' databases for no
            # reason is a bad trade for the word "random".
            brands = cycle(vendor_ids)
            added = {"categories": 0, "subcategories": 0, "models": 0}

            for c_order, (cat_name, cat_icon, subs) in enumerate(CATALOGUE, start=1):
                category = await _find(
                    session, ProductCategory, company.id, ProductCategory.name, cat_name
                )
                if category is None:
                    category = ProductCategory(
                        company_id=company.id,
                        name=cat_name,
                        icon_key=cat_icon,
                        sort_order=c_order,
                        is_active=True,
                    )
                    session.add(category)
                    await session.flush()
                    added["categories"] += 1
                elif category.deleted_at is not None:
                    continue  # removed on purpose; do not resurrect it

                for s_order, (sub_name, sub_icon, models) in enumerate(subs, start=1):
                    subcategory = await _find(
                        session,
                        ProductSubcategory,
                        company.id,
                        ProductSubcategory.name,
                        sub_name,
                        ProductSubcategory.category_id == category.id,
                    )
                    if subcategory is None:
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
                        added["subcategories"] += 1
                    elif subcategory.deleted_at is not None:
                        continue

                    for m_order, (name, capacity, warranty) in enumerate(
                        models, start=1
                    ):
                        # Drawn BEFORE the existence check, so a model gets the
                        # same brand whether it is created on this run or was
                        # created on a previous one. Skipping the draw would make
                        # the assignment depend on what already existed.
                        brand = next(brands)
                        found = await _find(
                            session,
                            ProductModel,
                            company.id,
                            ProductModel.name,
                            name,
                            ProductModel.subcategory_id == subcategory.id,
                        )
                        if found is not None:
                            continue
                        session.add(
                            ProductModel(
                                company_id=company.id,
                                subcategory_id=subcategory.id,
                                vendor_id=brand,
                                name=name,
                                capacity=capacity,
                                warranty_months=warranty,
                                sort_order=m_order,
                                is_active=True,
                            )
                        )
                        added["models"] += 1

            await session.commit()
            if any(added.values()):
                print(
                    f"{company.name}: seeded {added['categories']} categories, "
                    f"{added['subcategories']} subcategories, {added['models']} models"
                )
            else:
                print(f"{company.name}: catalogue already complete — nothing to add")


if __name__ == "__main__":
    asyncio.run(seed())
