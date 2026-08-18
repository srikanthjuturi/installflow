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
from datetime import datetime, timedelta, timezone
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
from app.models.ticket import Ticket  # noqa: E402
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
# What a technician can be sent to do, keyed by SUBCATEGORY rather than by
# model: every television behaves the same way here, and repeating the list on
# all five of them would be five chances to disagree. A model added by hand can
# still differ — this only seeds the sensible starting point.
#
# Deliberately a mix of one, two and three, so the checkbox group and its
# "Select all" are exercised the moment anyone opens the screen.
SERVICE_TYPES_BY_SUBCATEGORY: dict[str, list[str]] = {
    "Television": ["Installation + Demo", "Tech Visit"],
    # Split ACs are installed, demonstrated, and then serviced every season.
    "Air Conditioner": ["Installation + Demo", "Tech Visit", "Service"],
    "Washing Machine": ["Installation + Demo", "Service"],
    "Refrigerator": ["Installation + Demo", "Tech Visit"],
    # Sits on a counter and plugs in; there is nothing to service.
    "Microwave": ["Installation + Demo"],
    # The filters are the whole product — servicing is most of its life.
    "Water Purifier": ["Installation + Demo", "Service"],
}
DEFAULT_SERVICE_TYPES = ["Installation + Demo"]

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
                                # A copy per model — the literal is shared, and
                                # handing the same list object to a JSONB column
                                # twice is a bug waiting to happen.
                                service_types=list(
                                    SERVICE_TYPES_BY_SUBCATEGORY.get(
                                        sub_name, DEFAULT_SERVICE_TYPES
                                    )
                                ),
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

            await _seed_tickets(session, company)


# (customer, phone, address, city, state, pincode, subcategory, service_type,
#  description, serial, level_hours, slot_in_hours, status)
#
# `slot_in_hours` is relative to seeding time: None leaves the ticket without a
# slot, and a value LARGER than the service level produces a ticket that is
# already breaching — which is the state the list is sorted to surface, so the
# screen needs at least one.
Seeded = tuple[
    str, str, str, str, str, str, str, str, str | None, str | None, int, int | None, str
]
TICKETS: list[Seeded] = [
    (
        "Anil Deshmukh", "+919822041120", "B-1204, Oberoi Springs, Andheri West",
        "Pune", "Maharashtra", "411014", "Television", "Installation + Demo",
        None, "VDC43UHD-1180", 24, 8, "In Progress",
    ),
    (
        "Rajesh Nair", "+919876533110", "A-702, Raheja Heights, Baner Road",
        "Pimpri", "Maharashtra", "411018", "Washing Machine", "Installation + Demo",
        None, None, 24, 30, "Escalated",          # slot beyond the window: breach
    ),
    (
        "Sameer Bhosale", "+919011224455", "Flat 9, Sai Residency, NIBM Road",
        "Hadapsar", "Maharashtra", "411028", "Air Conditioner", "Service",
        "Cooling has dropped since the last service and the outdoor unit rattles.",
        None, 12, 6, "Assigned",
    ),
    (
        "Meera Kulkarni", "+919960771234", "12, Sunrise Society, Karve Nagar",
        "Kothrud", "Maharashtra", "411038", "Refrigerator", "Tech Visit",
        "Freezer compartment is icing over within a day of defrosting.",
        None, 36, None, "Slot Pending",           # no slot: burns the window
    ),
    (
        "Farhan Qureshi", "+919820998877", "301, Lake View, Wakad Road",
        "Wakad", "Maharashtra", "411057", "Microwave", "Installation + Demo",
        None, None, 48, 20, "New",
    ),
    (
        "Divya Menon", "+919833445566", "7, Green Acres, Aundh",
        "Aundh", "Maharashtra", "411007", "Water Purifier", "Service",
        "Filter change due and the tap is dripping continuously.",
        "VDC-RO8L-4471", 24, 14, "Closed",
    ),
]


async def _seed_tickets(session, company) -> None:
    """A spread of tickets so the list, its filters and the urgency sort mean
    something the first time somebody opens the screen.

    Skipped entirely for a company that already has any — these are a starting
    point, not a correction to real intake.
    """
    existing = await session.scalar(
        select(func.count(Ticket.id)).where(Ticket.company_id == company.id)
    )
    if existing:
        print(f"{company.name}: {existing} tickets already — skipped")
        return

    models = list(
        await session.scalars(
            select(ProductModel)
            .where(
                ProductModel.company_id == company.id,
                ProductModel.deleted_at.is_(None),
            )
            .order_by(ProductModel.sort_order)
        )
    )
    if not models:
        print(f"{company.name}: no product models yet — no tickets seeded")
        return

    subs = {
        s.id: s
        for s in await session.scalars(
            select(ProductSubcategory).where(
                ProductSubcategory.company_id == company.id,
                ProductSubcategory.deleted_at.is_(None),
            )
        )
    }
    now = datetime.now(timezone.utc)
    made = 0

    for index, row in enumerate(TICKETS):
        (
            customer, phone, address, city, state, pincode, sub_name,
            service_type, description, serial, level, slot_in, status,
        ) = row

        model = next(
            (m for m in models if subs.get(m.subcategory_id, None)
             and subs[m.subcategory_id].name == sub_name),
            None,
        )
        if model is None:
            continue

        slot_start = now + timedelta(hours=slot_in) if slot_in is not None else None
        session.add(
            Ticket(
                company_id=company.id,
                code=f"INST-{240912 + index}",
                vendor_id=model.vendor_id,
                subcategory_id=model.subcategory_id,
                model_id=model.id,
                service_type=service_type,
                description=description,
                serial_number=serial,
                customer_name=customer,
                customer_phone=phone,
                address=address,
                city=city,
                state=state,
                pincode=pincode,
                expected_date=(now + timedelta(days=1)).date(),
                service_level_hours=level,
                slot_start=slot_start,
                slot_end=slot_start + timedelta(hours=2) if slot_start else None,
                sla_due_at=now + timedelta(hours=level),
                status=status,
            )
        )
        made += 1

    await session.commit()
    print(f"{company.name}: seeded {made} tickets")


if __name__ == "__main__":
    asyncio.run(seed())
