"""A complete working environment, from an empty database.

    python -m app.scripts.bootstrap     # the platform superadmin
    python -m app.scripts.seed_demo     # everything else

Before this existed, resetting the database meant recreating three companies and
eleven users by hand through the console — an hour of clicking that nobody wants
to repeat, which in practice meant nobody ever reset it. That is how a schema
drifts. This makes a reset cheap, so it can happen whenever it needs to.

Per company it creates the company, one user of each management role with real
memberships and territory, and technicians with certifications and coverage;
then hands over to `seed_catalogue` for vendors, the product master and tickets.

The territory is built so the RELATIONSHIPS are exercisable, not just present:
the area manager reports to the regional head and covers the pincodes the seeded
tickets are actually in, so ticket visibility, technician eligibility and the
escalation path all have something real to resolve against.

Idempotent per company — a company that already exists is left alone.
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
from app.core.security import hash_password  # noqa: E402
from app.models import (  # noqa: E402
    Company,
    Membership,
    MembershipPincode,
    MembershipRegion,
    Region,
    User,
)
from app.models.role import (  # noqa: E402
    ADMIN,
    AREA_MANAGER,
    NATIONAL_HEAD,
    REGIONAL_HEAD,
    TECHNICIAN,
)
from app.models.technician import (  # noqa: E402
    TechnicianPincode,
    TechnicianProfile,
    TechnicianSubcategory,
)
from app.models.product import ProductSubcategory  # noqa: E402

#: One password for every seeded account. This is demo data on a disposable
#: database; generating something unguessable and then not telling anyone just
#: means nobody can sign in.
PASSWORD = "Password@123"

# (name, slug, city, state, pincode, gst, pan, region_code, [pincodes])
#
# The pincodes are the ones `seed_catalogue`'s tickets use, so the area manager
# genuinely covers their own queue rather than seeing an empty list.
COMPANIES = [
    (
        "Videocon Services", "videocon-services", "Pune", "Maharashtra", "411014",
        "27AAACV1111A1Z1", "AAACV1111A", "WEST",
        ["411014", "411018", "411028", "411038", "411057", "411007"],
    ),
    (
        "Kelvinator Care", "kelvinator-care", "Hyderabad", "Telangana", "500016",
        "36AAACK2222B1Z2", "AAACK2222B", "SOUTH",
        ["500016", "500060", "500032"],
    ),
    (
        "Sansui Support", "sansui-support", "New Delhi", "Delhi", "110044",
        "07AAACS3333C1Z3", "AAACS3333C", "NORTH",
        ["110044", "110019", "110025"],
    ),
]

# (role, local part of the email, full name)
STAFF = [
    (ADMIN, "admin", "Company Admin"),
    (NATIONAL_HEAD, "nh", "National Head"),
    (REGIONAL_HEAD, "rh", "Regional Head"),
    (AREA_MANAGER, "am", "Area Manager"),
]

# (full name, phone, [subcategory names], [pincode offsets into the company's list])
TECHNICIANS = [
    ("Sunil Pawar", "9{c}00000001", ["Television", "Air Conditioner"], [0, 1]),
    ("Ganesh More", "9{c}00000002", ["Washing Machine", "Refrigerator"], [0, 2]),
    ("Imran Shaikh", "9{c}00000003", ["Microwave", "Water Purifier"], [1]),
]


async def _seed_company(session, index: int, spec) -> None:
    (name, slug, city, state, pincode, gst, pan, region_code, pincodes) = spec

    existing = await session.scalar(
        select(Company).where(func.lower(Company.slug) == slug)
    )
    if existing is not None:
        print(f"{name}: already exists — skipped")
        return

    # `.example.com`, not `.test`: RFC 2606 reserves both, but the email
    # validator rejects the `.test` TLD outright, so a seeded account could not
    # sign in. Still unmistakably fake, still nobody's real address.
    domain = f"{slug}.example.com"
    company = Company(
        name=name, slug=slug, email=f"ops@{domain}",
        gst_number=gst, pan=pan, gst_company_status="Active",
        address_line1=f"1 {city} Road", city=city, state=state, pincode=pincode,
        is_active=True,
    )
    session.add(company)
    # autoflush is OFF (hard rule 8) and the ids are needed immediately below.
    await session.flush()

    region = await session.scalar(select(Region).where(Region.code == region_code))

    memberships: dict[str, Membership] = {}
    for role, local, label in STAFF:
        user = User(
            email=f"{local}@{domain}",
            password_hash=hash_password(PASSWORD),
            full_name=f"{label} · {name}",
            role=role,
            is_active=True,
        )
        session.add(user)
        await session.flush()

        membership = Membership(
            user_id=user.id,
            company_id=company.id,
            # The area manager reports to the regional head, which is what makes
            # a Regional Head's ticket visibility resolve to anything: their
            # reach is defined as the pincodes their AMs cover.
            manager_id=memberships[REGIONAL_HEAD].id if role == AREA_MANAGER else None,
            is_active=True,
        )
        session.add(membership)
        await session.flush()
        memberships[role] = membership

        # Territory: a regional head holds regions, an area manager holds
        # pincodes. All-India roles hold neither and are unrestricted.
        if role in (REGIONAL_HEAD, AREA_MANAGER) and region is not None:
            session.add(
                MembershipRegion(membership_id=membership.id, region_id=region.id)
            )
        if role == AREA_MANAGER:
            for pin in pincodes:
                session.add(
                    MembershipPincode(
                        membership_id=membership.id,
                        company_id=company.id,
                        pincode=pin,
                    )
                )

    await session.commit()
    print(f"{name}: company + {len(STAFF)} staff users")


async def _seed_technicians(session, index: int, spec) -> None:
    (name, slug, *_rest, region_code, pincodes) = spec
    company = await session.scalar(
        select(Company).where(func.lower(Company.slug) == slug)
    )
    if company is None:
        return

    already = await session.scalar(
        select(func.count(TechnicianProfile.id)).where(
            TechnicianProfile.company_id == company.id
        )
    )
    if already:
        print(f"{name}: {already} technicians already — skipped")
        return

    region = await session.scalar(select(Region).where(Region.code == region_code))
    subs = {
        s.name: s
        for s in await session.scalars(
            select(ProductSubcategory).where(
                ProductSubcategory.company_id == company.id,
                ProductSubcategory.deleted_at.is_(None),
            )
        )
    }
    if not subs:
        print(f"{name}: no product master yet — run seed_catalogue first")
        return

    manager = await session.scalar(
        select(Membership)
        .join(User, User.id == Membership.user_id)
        .where(Membership.company_id == company.id, User.role == AREA_MANAGER)
    )

    made = 0
    for n, (full_name, phone_tpl, subcategories, pin_idx) in enumerate(TECHNICIANS):
        phone = "+91" + phone_tpl.format(c=index + 1)[:10]
        user = User(
            # A technician has NO email and NO password — their phone is the
            # credential and they sign in with an OTP. This is why those two
            # columns are nullable.
            phone=phone,
            full_name=full_name,
            role=TECHNICIAN,
            is_active=True,
        )
        session.add(user)
        await session.flush()

        membership = Membership(
            user_id=user.id,
            company_id=company.id,
            manager_id=manager.id if manager else None,
            is_active=True,
        )
        session.add(membership)
        await session.flush()
        if region is not None:
            session.add(
                MembershipRegion(membership_id=membership.id, region_id=region.id)
            )

        profile = TechnicianProfile(
            membership_id=membership.id,
            company_id=company.id,
            code=f"TCH-{4021 + n}",
            region_id=region.id if region else None,
            daily_job_cap=5,
            status="active",
            onboarding_mode="direct",
            registered_by="manager",
        )
        session.add(profile)
        await session.flush()

        for sub_name in subcategories:
            sub = subs.get(sub_name)
            if sub is not None:
                session.add(
                    TechnicianSubcategory(
                        company_id=company.id,
                        technician_id=profile.id,
                        subcategory_id=sub.id,
                    )
                )
        for i in pin_idx:
            if i < len(pincodes):
                session.add(
                    TechnicianPincode(
                        company_id=company.id,
                        technician_id=profile.id,
                        pincode=pincodes[i],
                    )
                )
        made += 1

    await session.commit()
    print(f"{name}: {made} technicians with certifications and coverage")


async def seed() -> None:
    async with AsyncSessionLocal() as session:
        for i, spec in enumerate(COMPANIES):
            await _seed_company(session, i, spec)

    # The catalogue needs the companies to exist, and the technicians need the
    # catalogue — a technician certifies on a subcategory. Hence three passes.
    from app.scripts.seed_catalogue import seed as seed_catalogue

    print()
    await seed_catalogue()
    print()

    async with AsyncSessionLocal() as session:
        for i, spec in enumerate(COMPANIES):
            await _seed_technicians(session, i, spec)

    print()
    print("Sign in with any of these — password for all of them: " + PASSWORD)
    for _name, slug, *_ in COMPANIES:
        print(f"  {slug}:  " + "  ".join(f"{l}@{slug}.example.com" for _r, l, _n in STAFF))


if __name__ == "__main__":
    asyncio.run(seed())
