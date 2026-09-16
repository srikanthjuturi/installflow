"""Stand up one synthetic company: staff, a vendor, a catalogue, technicians.

Everything here goes through the real service functions rather than INSERTing
rows. It is slower and it fails more often, and both are the point: a company
assembled by hand would be missing the `company_rules` row, the stamped `code`,
the `membership_regions` link that makes a technician visible to a regional
head, and the credit entry that lets a ticket be raised at all. Those omissions
do not announce themselves — they surface later as an empty screen.

Read with `lifecycle.py`, which drives tickets through what this builds.
"""

import dataclasses
import hashlib
import random
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.credits import load_platform_settings
from app.core.deps import Principal
from app.features.companies import service as companies_service
from app.features.companies.schemas import CompanyCreateRequest
from app.features.credits import service as credits_service
from app.features.credits.schemas import RechargeClaimRequest, RechargeRequest
from app.features.masters import service as masters_service
from app.features.masters.schemas import ModelCreateRequest, NodeCreateRequest
from app.features.technicians import service as technicians_service
from app.features.technicians.schemas import TechnicianCreateRequest
from app.features.users import service as users_service
from app.features.users.schemas import UserCreateRequest
from app.features.vendors import service as vendors_service
from app.features.vendors.schemas import VendorCreateRequest
from app.models.product import ProductModel, ProductNode
from app.models.role import (
    ADMIN,
    AREA_MANAGER,
    NATIONAL_HEAD,
    REGIONAL_HEAD,
    ROLE_RANKS,
    SUPERADMIN,
)
from app.models.technician import TechnicianProfile
from app.models.territory import Pincode, State
from app.models.user import User
from app.models.vendor import Vendor
from app.models.vendor_brand import VendorBrand
from app.scripts.seed.guards import (
    REAL_TEAM_PHONES,
    SeedRefused,
    synthetic_email,
    synthetic_phone,
)

#: Every seeded company's name starts with this. `mint_load_sessions` refuses
#: any company that does not, so it can never hand out a real tenant's sessions.
SEED_COMPANY_PREFIX = "Seed Appliances "

#: The region the whole synthetic company works in. One region, not five,
#: because a technician's coverage must sit inside their own region and a
#: ticket is only offered to somebody covering its pincode — spreading the
#: seed across India would produce 500 tickets nobody is eligible for.
SEED_REGION = "South"

#: The catalogue. Each of these becomes a depth-1 node, which is both the level
#: a technician certifies on (`CERTIFY_DEPTH`) and — because these are leaves —
#: the level that holds products.
CATEGORIES: tuple[tuple[str, tuple[tuple[str, int, int], ...]], ...] = (
    # category, ((model, technician payout paise, vendor price paise), ...)
    (
        "Television",
        (
            ("Meridian 43\" LED", 45_000, 120_000),
            ("Meridian 55\" OLED", 65_000, 180_000),
        ),
    ),
    (
        "Air Conditioner",
        (
            ("Sunview 1.5T Split", 90_000, 240_000),
            ("Sunview 1T Window", 70_000, 190_000),
        ),
    ),
    (
        "Refrigerator",
        (
            ("Meridian 260L Frost Free", 55_000, 150_000),
            ("Meridian 190L Direct Cool", 40_000, 110_000),
        ),
    ),
    (
        "Washing Machine",
        (
            ("Sunview 7kg Front Load", 60_000, 165_000),
            ("Sunview 6.5kg Top Load", 45_000, 125_000),
        ),
    ),
    (
        "Solar Water Heater",
        (
            ("Sunview 200L Rooftop", 120_000, 320_000),
            ("Sunview 100L Rooftop", 95_000, 260_000),
        ),
    ),
)

#: Fifty technicians. Real-looking names, because every screen in the demo shows
#: one and "Technician 27" reads as what it is.
TECHNICIAN_NAMES: tuple[str, ...] = (
    "Ravi Kumar", "Suresh Babu", "Anil Reddy", "Mahesh Naidu", "Venkat Rao",
    "Prakash Sharma", "Ganesh Iyer", "Srinivas Rao", "Kiran Kumar", "Ramesh Babu",
    "Naveen Chandra", "Satish Varma", "Dinesh Pillai", "Harish Menon", "Manoj Nair",
    "Rajesh Gupta", "Vinod Krishnan", "Sandeep Yadav", "Arun Prasad", "Balaji Subramani",
    "Chandra Sekhar", "Deepak Joshi", "Eshwar Rao", "Firoz Khan", "Gopal Krishna",
    "Hari Prasad", "Imran Sheikh", "Jagadish Rao", "Karthik Raja", "Lokesh Gowda",
    "Murali Mohan", "Nagaraju Setty", "Om Prakash", "Pavan Kalyan", "Raghu Varma",
    "Sailesh Chandra", "Tarun Kumar", "Uday Bhaskar", "Vijay Anand", "Yogesh Patil",
    "Ashok Kumar", "Bhaskar Reddy", "Chetan Bhat", "Devendra Singh", "Girish Hegde",
    "Jayanth Kumar", "Kishore Babu", "Madhav Rao", "Nithin Raj", "Purushotham Naidu",
)


def phone_block(tag: str) -> int:
    """A 100,000-number block of `+911…` reserved for one run.

    `uq_users_phone_technician` is global, so two runs handing out the same
    invented numbers collide on the second one — and the collision surfaces
    halfway through building a company, leaving a half-seeded tenant behind.
    Derived with hashlib rather than `hash()`, which is salted per process and
    would give the same tag a different block every time it ran.
    """
    digest = hashlib.md5(tag.encode()).hexdigest()
    return (int(digest[:8], 16) % 9_000) * 100_000


@dataclasses.dataclass
class Tenant:
    """Everything `lifecycle.py` needs to drive a ticket, gathered once."""

    company_id: uuid.UUID
    company_name: str
    superadmin: Principal
    #: Company-scoped superadmin — rank 0 inside this tenant, which is what
    #: `ensure_below_rank` wants when creating an admin.
    owner: Principal
    admin: Principal
    vendor_principal: Principal
    vendor_id: uuid.UUID
    region_id: uuid.UUID
    #: node id -> the models hanging off it, as (model_id, service_types).
    models_by_node: dict[uuid.UUID, list[tuple[uuid.UUID, list[str]]]]
    pincodes: list[str]
    technicians: list[TechnicianProfile]
    #: This run's reserved block of unreachable numbers — customers are drawn
    #: from its upper half, so no two runs ever mint the same phone.
    phone_block: int


async def principal_for(
    db: AsyncSession, user: User, *, company_id: uuid.UUID | None, rank: int | None = None
) -> Principal:
    """Build a `Principal` by hand, the way `ws.py` already does.

    `rank` overrides the role's own — the superadmin acting INSIDE a company
    keeps rank 0, which is what lets it create that company's admin.
    """
    return Principal(
        user=user,
        role=user.role,
        rank=ROLE_RANKS[user.role] if rank is None else rank,
        is_superadmin=user.role == SUPERADMIN,
        company_id=company_id,
        vendor_id=None,
    )


async def _user_by_email(db: AsyncSession, email: str) -> User:
    user = await db.scalar(select(User).where(User.email == email.lower()))
    if user is None:
        raise SeedRefused(f"No account was created for {email} — seeding stopped.")
    return user


async def _phone_taken(db: AsyncSession, phone: str) -> bool:
    """Is this number already a live technician anywhere in the database?"""
    from app.models.role import TECHNICIAN

    return bool(
        await db.scalar(
            select(User.id).where(
                User.phone == phone,
                User.role == TECHNICIAN,
                User.deleted_at.is_(None),
            )
        )
    )


async def _superadmin(db: AsyncSession) -> User:
    user = await db.scalar(select(User).where(User.role == SUPERADMIN).limit(1))
    if user is None:
        raise SeedRefused(
            "No superadmin exists. Run `python -m app.scripts.bootstrap` first."
        )
    return user


async def _pick_pincodes(db: AsyncSession, region_id: uuid.UUID, *, count: int) -> list[str]:
    """Active pincodes inside the seed region, taken in a stable order.

    Deliberately a small set shared by technicians and tickets: coverage is what
    decides whether a job is ever offered, so a wide spread would leave most of
    the pool invisible to everybody.
    """
    rows = await db.scalars(
        select(Pincode.code)
        .join(State, State.id == Pincode.state_id)
        .where(State.region_id == region_id, Pincode.is_active.is_(True))
        .order_by(Pincode.code)
        .limit(count)
    )
    codes = list(rows)
    if len(codes) < count:
        raise SeedRefused(
            f"Only {len(codes)} active pincodes in the {SEED_REGION} region — "
            f"the geography master looks unloaded."
        )
    return codes


async def build(
    db: AsyncSession,
    *,
    tag: str,
    technician_count: int,
    ticket_count: int,
    real_phones: tuple[str, ...] = REAL_TEAM_PHONES,
    rng: random.Random,
) -> Tenant:
    """Create the company and everything under it. Idempotent it is NOT.

    `tag` disambiguates a second run — it lands in the company name, the GSTIN
    and every synthetic address, so two seeds never collide on a unique index.
    """
    superadmin_user = await _superadmin(db)
    superadmin = await principal_for(db, superadmin_user, company_id=None)
    block = phone_block(tag)

    # ── the company ───────────────────────────────────────────────────────
    # A GSTIN that satisfies the pattern and belongs to nobody: 36 is Telangana,
    # the rest is derived from `tag`, stably — so re-running the SAME tag is
    # refused as a duplicate rather than quietly building a second company that
    # looks identical.
    digits = f"{int(hashlib.md5(tag.encode()).hexdigest()[8:12], 16) % 10_000:04d}"
    gst = f"36SEEDX{digits}A1Z5"
    company = await companies_service.create_company(
        db,
        superadmin,
        CompanyCreateRequest(
            name=f"{SEED_COMPANY_PREFIX}{tag}",
            # No `code`: a typed one is refused on collision, while a DERIVED
            # one gets a numeric suffix from `company_code.derive`. Letting the
            # product's own mechanism answer is what makes a second run work.
            code=None,
            email=synthetic_email(f"admin.{tag.lower()}"),
            phone=synthetic_phone(900_000_001),
            adminName="Seed Admin",
            gstNumber=gst,
            pan=gst[2:12],
            gstCompanyStatus="Active",
            addressLine1="Plot 1, Seed Industrial Estate",
            city="Hyderabad",
            state="Telangana",
            pincode="500081",
        ),
    )
    company_id = company.id
    owner = await principal_for(db, superadmin_user, company_id=company_id, rank=0)

    region_id = await _seed_region_id(db)
    pincodes = await _pick_pincodes(db, region_id, count=20)

    # ── staff ─────────────────────────────────────────────────────────────
    # One of each role, because the console demo shows territory scoping and a
    # company with only an admin cannot show it. Ranks matter: each is created
    # by somebody above it.
    #
    # The response carries no admin id, so the account is found by the address
    # it was created with — which is this script's own, not a guess.
    admin_user = await _user_by_email(db, company.email)
    admin = await principal_for(db, admin_user, company_id=company_id)

    await users_service.create_user(
        db,
        admin,
        UserCreateRequest(
            email=synthetic_email(f"nh.{tag.lower()}"),
            fullName="Seed National Head",
            phone=synthetic_phone(900_000_002),
            role=NATIONAL_HEAD,
            regionIds=[],
            stateIds=[],
        ),
    )
    await users_service.create_user(
        db,
        admin,
        UserCreateRequest(
            email=synthetic_email(f"rh.{tag.lower()}"),
            fullName="Seed Regional Head",
            phone=synthetic_phone(900_000_003),
            role=REGIONAL_HEAD,
            regionIds=[region_id],
            stateIds=[],
        ),
    )
    state_ids = list(
        await db.scalars(
            select(State.id).where(State.region_id == region_id).order_by(State.name).limit(1)
        )
    )
    await users_service.create_user(
        db,
        admin,
        UserCreateRequest(
            email=synthetic_email(f"am.{tag.lower()}"),
            fullName="Seed Area Manager",
            phone=synthetic_phone(900_000_004),
            role=AREA_MANAGER,
            regionIds=[],
            stateIds=state_ids,
        ),
    )

    # ── the vendor, and the account that raises every ticket ──────────────
    vendor = await vendors_service.create_vendor(
        db,
        admin,
        VendorCreateRequest(
            name=f"Crestline Distributors {tag}",
            gstNumber=f"36SEEDY{digits}A1Z5",
            pan=f"SEEDY{digits}A",
            contactPerson="Seed Vendor Contact",
            phone=synthetic_phone(900_000_005),
            address="Shed 4, Seed Distribution Park",
            city="Hyderabad",
            state="Telangana",
            pincode="500081",
            loginEmail=synthetic_email(f"vendor.{tag.lower()}"),
            brands=["Meridian", "Sunview"],
            # Left ON, the product's own default: the live proof photo is
            # location-gated, and the seed satisfies it honestly by sending a
            # device pincode that matches the ticket's.
            locationCheckEnabled=True,
        ),
    )
    vendor_row = await db.get(Vendor, vendor.id)
    vendor_user = await _user_by_email(db, synthetic_email(f"vendor.{tag.lower()}"))
    vendor_principal = Principal(
        user=vendor_user,
        role=vendor_user.role,
        rank=ROLE_RANKS[vendor_user.role],
        is_superadmin=False,
        company_id=company_id,
        vendor_id=vendor_row.id,
    )

    # ── the catalogue ─────────────────────────────────────────────────────
    # ⚠ Both writers answer with the whole TREE — `create_node` returns
    # `_one_root(...)` and `create_model` the same — so neither response's `id`
    # is the thing just created. The row is found by the name it was given.
    await masters_service.create_node(
        db, admin, NodeCreateRequest(name="Home Appliances", isLeaf=False)
    )
    root_id = await _node_id(db, company_id, parent_id=None, name="Home Appliances")

    # A vendor with more than one approved brand must be told which one a
    # product carries. Every model here is named after its own brand, which is
    # how a real catalogue reads anyway.
    brands = {
        name: brand_id
        for brand_id, name in (
            await db.execute(
                select(VendorBrand.id, VendorBrand.name).where(
                    VendorBrand.vendor_id == vendor_row.id
                )
            )
        ).all()
    }

    models_by_node: dict[uuid.UUID, list[tuple[uuid.UUID, list[str]]]] = {}
    for category, models in CATEGORIES:
        await masters_service.create_node(
            db,
            admin,
            NodeCreateRequest(name=category, parentId=root_id, isLeaf=True),
        )
        node_id = await _node_id(db, company_id, parent_id=root_id, name=category)
        made: list[tuple[uuid.UUID, list[str]]] = []
        for name, payout, price in models:
            await masters_service.create_model(
                db,
                admin,
                node_id,
                ModelCreateRequest(
                    name=name,
                    vendorId=vendor_row.id,
                    brandId=brands[name.split()[0]],
                    serviceTypes=["Installation + Demo", "Service"],
                    technicianPayoutPaise=payout,
                    vendorPricePaise=price,
                ),
            )
            model_id = await _model_id(db, node_id, name=name)
            made.append((model_id, ["Installation + Demo", "Service"]))
        models_by_node[node_id] = made
        # No `product_model_serials` are loaded, and that is deliberate: an
        # EMPTY serial list means the intake check is OFF for that model, so
        # 500 invented serial numbers are accepted. Loading serials would mean
        # inventing a matching one per ticket for no gain.

    # ── credits ───────────────────────────────────────────────────────────
    await _recharge(db, owner=owner, admin=admin, ticket_count=ticket_count)

    # ── technicians ───────────────────────────────────────────────────────
    node_ids = list(models_by_node)
    # A technician's phone is their identity, and `uq_users_phone_technician` is
    # global — so a real number can belong to exactly ONE technician in the
    # whole database, company boundaries included. A second seed run must not
    # die on that, so a number already taken is stepped over and reported.
    free_real = [p for p in real_phones if not await _phone_taken(db, p)]
    if len(free_real) < len(real_phones):
        print(
            f"    note: {len(real_phones) - len(free_real)} of the team's "
            f"numbers already belong to a technician; those slots get "
            f"unreachable numbers instead."
        )

    technicians: list[TechnicianProfile] = []
    for index in range(technician_count):
        # The first few carry the team's own phones so a real OTP sign-in can
        # be tested; everybody else is unreachable by construction.
        phone = (
            free_real[index]
            if index < len(free_real)
            else synthetic_phone(block + index)
        )
        # Two or three categories each, overlapping, so no ticket is uncoverable
        # and the pool is genuinely contested — which is what the accept race in
        # the load test needs.
        certified = rng.sample(node_ids, k=rng.choice((2, 3)))
        covered = rng.sample(pincodes, k=rng.choice((6, 8, 10)))
        created = await technicians_service.create_technician(
            db,
            admin,
            TechnicianCreateRequest(
                fullName=TECHNICIAN_NAMES[index % len(TECHNICIAN_NAMES)],
                phone=phone,
                regionId=region_id,
                subcategoryIds=certified,
                pincodes=covered,
                # Left NULL for most, which is what a real new technician has:
                # no cap until somebody has a basis for one. A handful get one
                # so the console has something to show.
                dailyJobCap=rng.choice((None, None, None, 4, 6)),
            ),
        )
        profile = await db.get(TechnicianProfile, created.id)
        technicians.append(profile)

    return Tenant(
        company_id=company_id,
        company_name=company.name,
        superadmin=superadmin,
        owner=owner,
        admin=admin,
        vendor_principal=vendor_principal,
        vendor_id=vendor_row.id,
        region_id=region_id,
        models_by_node=models_by_node,
        pincodes=pincodes,
        technicians=technicians,
        phone_block=block,
    )


async def _node_id(
    db: AsyncSession, company_id: uuid.UUID, *, parent_id: uuid.UUID | None, name: str
) -> uuid.UUID:
    stmt = select(ProductNode.id).where(
        ProductNode.company_id == company_id,
        ProductNode.name == name,
        ProductNode.deleted_at.is_(None),
    )
    stmt = stmt.where(
        ProductNode.parent_id.is_(None)
        if parent_id is None
        else ProductNode.parent_id == parent_id
    )
    node_id = await db.scalar(stmt)
    if node_id is None:
        raise SeedRefused(f"The category {name!r} was not created — seeding stopped.")
    return node_id


async def _model_id(db: AsyncSession, node_id: uuid.UUID, *, name: str) -> uuid.UUID:
    model_id = await db.scalar(
        select(ProductModel.id).where(
            ProductModel.node_id == node_id,
            ProductModel.name == name,
            ProductModel.deleted_at.is_(None),
        )
    )
    if model_id is None:
        raise SeedRefused(f"The product {name!r} was not created — seeding stopped.")
    return model_id


async def _seed_region_id(db: AsyncSession) -> uuid.UUID:
    from app.models.territory import Region

    region_id = await db.scalar(select(Region.id).where(Region.name == SEED_REGION))
    if region_id is None:
        raise SeedRefused(f"No {SEED_REGION!r} region — geography is not loaded.")
    return region_id


async def _recharge(
    db: AsyncSession, *, owner: Principal, admin: Principal, ticket_count: int
) -> None:
    """Buy enough credits for the tickets about to be raised."""
    platform = await load_platform_settings(db)
    await top_up_credits(
        db, admin=admin, credits=ticket_count * platform.ticket_credits, owner=owner
    )


async def top_up_credits(
    db: AsyncSession,
    *,
    admin: Principal,
    credits: int,
    owner: Principal | None = None,
) -> None:
    """Recharge a company by `credits`, the way a real one is recharged.

    The realistic path — request, claim, superadmin confirms — rather than an
    inserted `credit_entries` row, because the confirmation is the only thing
    that adds credits and a demo that shows the Credits screen should show a
    recharge that went through it.

    `owner` is whoever confirms; left out, the platform's superadmin does.
    """
    platform = await load_platform_settings(db)
    if not platform.upi_id or not platform.upi_name:
        raise SeedRefused(
            "The platform has no UPI ID on Super Admin → Rules, so a recharge "
            "cannot be raised. Set one, or seed fewer tickets than the free "
            "credits cover."
        )
    if owner is None:
        owner = await principal_for(
            db, await _superadmin(db), company_id=admin.company_id, rank=0
        )
    needed = max(platform.min_recharge_credits, credits)
    recharge = await credits_service.create_recharge(
        db, admin, RechargeRequest(amountRupees=needed)
    )
    await credits_service.claim_recharge(
        db,
        admin,
        recharge.id,
        RechargeClaimRequest(
            utr=f"SEED{uuid.uuid4().hex[:12].upper()}",
            proof={"blobName": f"attachment/{admin.company_id}/seed-recharge.png"},
        ),
    )
    await credits_service.confirm(db, owner, recharge.id)
