"""Stand up one synthetic company: staff, a vendor, a catalogue, technicians.

Everything here goes through the real service functions rather than INSERTing
rows. It is slower and it fails more often, and both are the point: a company
assembled by hand would be missing the `company_rules` row, the stamped `code`,
the `membership_regions` link that makes a technician visible to a regional
head, and the credit entry that lets a ticket be raised at all. Those omissions
do not announce themselves — they surface later as an empty screen.

Read with `lifecycle.py`, which drives tickets through what this builds.

Since the franchisee programme (Task 16, §5.1) it also dresses the company the
way a real one looks: a second and third franchisee carved out of its pincodes,
employees beside freelancers, travel and speed rules that pay something, a spare
parts list and the facility staff who answer it. Every one of those goes through
the same service a console screen calls — a seed that INSERTed a franchisee
would skip the carve-out, the travel-rule stamp and the login, and `verify.py`
would then be reading rows nobody could have produced.
"""

import dataclasses
import hashlib
import random
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.base_location import BaseLocationIn
from app.core.credits import load_platform_settings
from app.core.deps import Principal
from app.core.facility_users import FacilityUserCreateRequest
from app.core.facility_users import create_user as create_facility_user
from app.core.franchise import home_franchisee_id
from app.features.companies import service as companies_service
from app.features.companies.schemas import CompanyCreateRequest
from app.features.credits import service as credits_service
from app.features.credits.schemas import RechargeClaimRequest, RechargeRequest
from app.features.franchisees import service as franchisees_service
from app.features.franchisees.schemas import (
    FranchiseeAdminIn,
    FranchiseeCreateRequest,
    PincodesRequest,
)
from app.features.masters import service as masters_service
from app.features.masters.schemas import ModelCreateRequest, NodeCreateRequest
from app.features.technicians import service as technicians_service
from app.features.spare_parts import service as parts_service
from app.features.spare_parts.schemas import SparePartCreate
from app.features.technicians.schemas import (
    TechnicianCreateRequest,
    TechnicianUpdateRequest,
)
from app.features.users import service as users_service
from app.features.users.schemas import UserCreateRequest
from app.features.vendors import service as vendors_service
from app.features.vendors.schemas import VendorCreateRequest
from app.models.franchisee import FranchiseeTravelRule
from app.models.franchisee_speed_rule import FranchiseeSpeedRule
from app.models.product import ProductModel, ProductNode
from app.models.role import (
    ADMIN,
    AREA_MANAGER,
    NATIONAL_HEAD,
    REGIONAL_HEAD,
    ROLE_RANKS,
    SUPERADMIN,
)
from app.models.technician import TechnicianPincode, TechnicianProfile
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


#: Who a technician works for, by position — a repeating pattern rather than a
#: draw, so a six-technician demo and a fifty-technician load test both contain
#: every case. Coverage is chosen FROM the group, because a carve-out only moves
#: someone whose coverage lies wholly inside the new range (F6): random coverage
#: from twenty pincodes almost never would, and the second franchisee would be
#: empty.
#:
#: * ``home``      stays home — coverage inside the part nobody claims;
#: * ``straddle``  stays home but is TRIMMED — coverage on both sides, so the
#:                 carve-out takes some of it away (F6's second rule);
#: * ``crestline`` MOVES to the external franchisee;
#: * ``northgate`` MOVES to the internal one that deliberately has no facility.
COVERAGE_CYCLE: tuple[str, ...] = (
    "home", "home", "straddle", "crestline", "crestline", "northgate",
)

#: The parts list the seed puts on the first category (and its first product),
#: and the names a technician types as "Other" on every other category.
PARTS_ON_CATEGORY: tuple[str, ...] = ("Power supply board", "Remote sensor")
PART_ON_MODEL = "Backlight strip"
OTHER_PART_NAMES: tuple[str, ...] = ("Drain pump", "Door lock", "Inlet hose", "Fan motor")

#: The money the seed configures, so the allowance rows are non-zero (TA3/S1):
#: a step of 2 km, ₹10 a step, road factor 130 %, ₹300 cap — and one speed rule,
#: 12 h -> ₹200, 24 h -> ₹150.
#:
#: The free distance is NOT the product's default (20 km freelancer / 30 km
#: employee). Every pincode in the seed lies inside one city, a few kilometres
#: apart, so the defaults would pay ₹0 on every job and `verify`'s travel checks
#: would read no rows at all; 2 km / 4 km keeps the rule on its normal shape and
#: lets a job a few kilometres from its technician's base pay a step or two.
TRAVEL_FREE_KM = {"freelancer": 2, "employee": 4}
TRAVEL_STEP_KM = 2
TRAVEL_PAISE_PER_STEP = 1_000
TRAVEL_ROAD_FACTOR_PCT = 130
TRAVEL_MAX_PAISE = 30_000
SPEED_REWARD_WITHIN_H = 12
SPEED_PENALTY_AFTER_H = 24
SPEED_REWARD_PAISE = 20_000
SPEED_PENALTY_PAISE = 15_000


def split_pincodes(pincodes: list[str]) -> tuple[list[str], list[str], list[str]]:
    """The seed's pincodes as (home's, Crestline's, Northgate's).

    Home keeps the first half — it is the catch-all and owns whatever nobody
    claims — Crestline takes the next 30 %, Northgate the last 20 %. Sorted
    input in, three disjoint slices out.
    """
    n = len(pincodes)
    return pincodes[: n // 2], pincodes[n // 2 : n * 4 // 5], pincodes[n * 4 // 5 :]


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


@dataclasses.dataclass(frozen=True)
class Names:
    """What a person reads on screen. The load test keeps the defaults; the
    client demo (`seed_demo.py`) passes names a customer would recognise."""

    company: str | None = None
    admin: str = "Seed Admin"
    national_head: str = "Seed National Head"
    regional_head: str = "Seed Regional Head"
    area_manager: str = "Seed Area Manager"
    vendor: str | None = None
    vendor_contact: str = "Seed Vendor Contact"


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
    #: Every franchisee of the company with the logins that act for it —
    #: home first. Empty only for a caller that skipped the franchisee setup.
    franchisees: list["FranchiseeSeed"] = dataclasses.field(default_factory=list)
    #: node id -> the catalogue `spare_parts` rows on that node. Only the first
    #: category has any; every other category's requests are typed as "Other".
    parts_by_node: dict[uuid.UUID, list[uuid.UUID]] = dataclasses.field(default_factory=dict)
    #: What the setup did, for the progress lines.
    setup_report: dict[str, int] = dataclasses.field(default_factory=dict)

    def franchisee_seed(self, franchisee_id: uuid.UUID) -> "FranchiseeSeed | None":
        return next((f for f in self.franchisees if f.id == franchisee_id), None)


@dataclasses.dataclass
class FranchiseeSeed:
    """One franchisee and the people who act for it."""

    id: uuid.UUID
    name: str
    code: str
    is_home: bool
    #: Its franchisee admin. None for home: the company's Admin stands in for
    #: it there (F8), exactly as on a real home franchisee.
    admin: Principal | None
    #: A facility operator, or None when the franchisee DELIBERATELY has no
    #: facility so the `NO_FACILITY` refusal is a path the seed walks (P8).
    facility: Principal | None


async def principal_for(
    db: AsyncSession,
    user: User,
    *,
    company_id: uuid.UUID | None,
    rank: int | None = None,
    franchisee_id: uuid.UUID | None = None,
) -> Principal:
    """Build a `Principal` by hand, the way `ws.py` already does.

    `rank` overrides the role's own — the superadmin acting INSIDE a company
    keeps rank 0, which is what lets it create that company's admin.

    `franchisee_id` is for the three franchise roles, whose authority is the
    franchisee on their membership (never a rank): leave it out and a franchise
    principal would fail every wall, which is the right way for it to fail.
    """
    return Principal(
        user=user,
        role=user.role,
        rank=ROLE_RANKS[user.role] if rank is None else rank,
        is_superadmin=user.role == SUPERADMIN,
        company_id=company_id,
        vendor_id=None,
        franchisee_id=franchisee_id,
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
    names: Names = Names(),
    recharge: bool = True,
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
            name=names.company or f"{SEED_COMPANY_PREFIX}{tag}",
            # No `code`: a typed one is refused on collision, while a DERIVED
            # one gets a numeric suffix from `company_code.derive`. Letting the
            # product's own mechanism answer is what makes a second run work.
            code=None,
            email=synthetic_email(f"admin.{tag.lower()}"),
            phone=synthetic_phone(900_000_001),
            adminName=names.admin,
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
            fullName=names.national_head,
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
            fullName=names.regional_head,
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
            fullName=names.area_manager,
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
            name=names.vendor or f"Crestline Distributors {tag}",
            gstNumber=f"36SEEDY{digits}A1Z5",
            pan=f"SEEDY{digits}A",
            contactPerson=names.vendor_contact,
            phone=synthetic_phone(900_000_005),
            address="Shed 4, Seed Distribution Park",
            city="Hyderabad",
            state="Telangana",
            pincode="500081",
            loginEmail=synthetic_email(f"vendor.{tag.lower()}"),
            brands=["Meridian", "Sunview"],
            # The credit line's ceiling. A vendor is created with ₹5,000 of
            # room, and every ticket it raises RESERVES its price until it
            # closes, so the default admits about three tickets and refuses the
            # other 497 with 409 VENDOR_OUT_OF_CREDITS - the seed shipped a
            # month before the line did and silently stopped working when it
            # landed. `drive` counts a refusal rather than failing on it, which
            # is how a "successful" run came back with an empty company.
            creditLimitPaise=1_000_000_000,
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
    # Skippable because it needs the platform's UPI ID, and a demo small enough
    # for the free credits has no other reason to fail on its absence.
    if recharge:
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
        covered = _coverage_for(COVERAGE_CYCLE[index % len(COVERAGE_CYCLE)], pincodes, rng)
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

    tenant = Tenant(
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

    # ── franchisees, employees, allowances, parts ─────────────────────────
    # After the technicians exist (a carve-out moves PEOPLE) and before any
    # ticket (a ticket is stamped, and its job snapshots, from what is true
    # when it is raised).
    await _franchise_setup(db, tenant, tag=tag)
    return tenant


def _coverage_for(group: str, pincodes: list[str], rng: random.Random) -> list[str]:
    """Pincodes for one technician, drawn from the slice their group lives in."""
    home, crest, north = split_pincodes(pincodes)
    if group == "home":
        return rng.sample(home, k=min(len(home), rng.choice((4, 5, 6))))
    if group == "straddle":
        # Both sides, so the Crestline carve-out takes the second three away.
        return rng.sample(home, k=min(len(home), 3)) + rng.sample(
            crest, k=min(len(crest), 3)
        )
    if group == "crestline":
        return rng.sample(crest, k=min(len(crest), rng.choice((3, 4, 5))))
    return rng.sample(north, k=min(len(north), rng.choice((2, 3))))


async def _stored_coverage(db: AsyncSession, profile: TechnicianProfile) -> list[str]:
    return sorted(
        await db.scalars(
            select(TechnicianPincode.pincode).where(
                TechnicianPincode.technician_id == profile.id
            )
        )
    )


async def _franchise_admin(
    db: AsyncSession, *, company_id: uuid.UUID, franchisee_id: uuid.UUID, email: str
) -> Principal:
    user = await _user_by_email(db, email)
    return await principal_for(
        db, user, company_id=company_id, franchisee_id=franchisee_id
    )


async def _franchise_setup(db: AsyncSession, tenant: Tenant, *, tag: str) -> None:
    """Task 16 §5.1 rows 2-6: the franchisee-era shape of the seeded company."""
    company_id = tenant.company_id
    admin = tenant.admin
    low = tag.lower()
    home_id = await home_franchisee_id(db, company_id)
    home_codes, crest_codes, north_codes = split_pincodes(tenant.pincodes)
    report: dict[str, int] = {}

    # -- two franchisees, each with an admin login (a real carve-out) -------
    made = {}
    for key, name, kind, codes, mailbox, phone_index in (
        ("crestline", f"Crestline Field Services {tag}", "external", crest_codes,
         f"franchise.{low}", 900_000_006),
        ("northgate", f"Northgate Field Services {tag}", "internal", north_codes,
         f"franchise.north.{low}", 900_000_008),
    ):
        created = await franchisees_service.create_franchisee(
            db,
            admin,
            FranchiseeCreateRequest(
                name=name,
                kind=kind,
                contactName=f"{name} Contact",
                contactPhone=synthetic_phone(phone_index),
                admin=FranchiseeAdminIn(
                    fullName=f"{key.title()} Admin",
                    email=synthetic_email(mailbox),
                    phone=synthetic_phone(phone_index + 1),
                ),
            ),
        )
        if created.admin is not None and created.admin.temporaryPassword:
            # The mailbox cannot receive mail (that is the point of the
            # address), so the server hands the password back — the vendor-
            # login pattern. Printed once; the demo resets it to a known one.
            print(
                f"    note: {created.admin.email} could not be mailed — "
                f"temporary password {created.admin.temporaryPassword}"
            )
        change = await franchisees_service.set_pincodes(
            db,
            admin,
            created.id,
            PincodesRequest(pincodeRanges=", ".join(codes)),
            dry_run=False,
        )
        report[f"{key} moved"] = len(change.movedTechnicians)
        report[f"{key} trimmed"] = len(change.trimmedTechnicians)
        made[key] = (created, mailbox)
        print(
            f"    {name}: {len(codes)} pincodes — "
            f"{len(change.movedTechnicians)} technicians moved, "
            f"{len(change.trimmedTechnicians)} trimmed"
        )

    # The carve-out rewrote profiles underneath objects this session already
    # holds — read them back before anything below judges "whose" they are.
    for profile in tenant.technicians:
        await db.refresh(profile)

    crest, crest_mailbox = made["crestline"]
    north, north_mailbox = made["northgate"]
    seeds = [
        FranchiseeSeed(home_id, tenant.company_name, "HOME", True, None, None),
        FranchiseeSeed(
            crest.id, crest.name, crest.code, False,
            await _franchise_admin(
                db, company_id=company_id, franchisee_id=crest.id,
                email=synthetic_email(crest_mailbox),
            ),
            None,
        ),
        FranchiseeSeed(
            north.id, north.name, north.code, False,
            await _franchise_admin(
                db, company_id=company_id, franchisee_id=north.id,
                email=synthetic_email(north_mailbox),
            ),
            None,
        ),
    ]
    actor_of = {s.id: (s.admin or admin) for s in seeds}
    tenant.franchisees = seeds

    by_franchisee: dict[uuid.UUID, list[TechnicianProfile]] = {s.id: [] for s in seeds}
    for profile in tenant.technicians:  # creation order = position order
        by_franchisee.setdefault(profile.franchisee_id, []).append(profile)

    # -- employees: the second technician of every five, per franchisee -----
    # Never the first, so every franchisee keeps a freelancer; done before any
    # job exists because a type change is refused over an open job or money.
    employees = 0
    for fid, people in by_franchisee.items():
        for ordinal, profile in enumerate(people):
            if ordinal % 5 != 1:
                continue
            await technicians_service.update_technician(
                db, actor_of[fid], profile.id,
                TechnicianUpdateRequest(technicianType="employee"),
            )
            await db.refresh(profile)
            employees += 1
    report["employees"] = employees

    # -- travel: non-zero rules for both types at every franchisee ----------
    # Written onto the two rows `stamp_travel_rules` made at creation (TA4), the
    # way `put_travel_rules` does - but not THROUGH it. ⚠ That function (and
    # `get_travel_rules`, so every GET/PUT travel endpoint) answers with
    # `TravelRuleIO.model_validate(<ORM row>)`, whose camelCase fields do not
    # exist on the snake_case row, so it raises a ValidationError after the
    # write. Found by Task 16 and reported, not fixed here (no feature code);
    # switch this back to `put_travel_rules` when `get_travel_rules` builds the
    # model from the columns.
    for s_ in seeds:
        for row in await db.scalars(
            select(FranchiseeTravelRule).where(
                FranchiseeTravelRule.company_id == company_id,
                FranchiseeTravelRule.franchisee_id == s_.id,
            )
        ):
            row.free_km = TRAVEL_FREE_KM[row.technician_type]
            row.step_km = TRAVEL_STEP_KM
            row.paise_per_step = TRAVEL_PAISE_PER_STEP
            row.road_factor_pct = TRAVEL_ROAD_FACTOR_PCT
            row.max_paise_per_job = TRAVEL_MAX_PAISE
            row.updated_by = actor_of[s_.id].user_id
    await db.commit()

    # -- base location: all but the third of every five ---------------------
    # The unset one is what produces `no_base_location` on its jobs (TA8).
    based = 0
    for fid, people in by_franchisee.items():
        for ordinal, profile in enumerate(people):
            if ordinal % 5 == 2:
                continue
            coverage = await _stored_coverage(db, profile)
            if not coverage:
                continue
            # The centre of the first of their pincodes, sent as a MAP point
            # rather than as `pincode=...`. ⚠ The pincode branch of
            # `core.base_location.resolve_base` awaits `execute(...)` and then
            # calls `.one_or_none()` on the coroutine, so every pincode base
            # raises AttributeError (found by Task 16, reported, not fixed - no
            # feature code). Switch back to `BaseLocationIn(pincode=...)` -
            # which also records `source = 'pincode'` - once that is fixed.
            lat, lng = (
                await db.execute(
                    select(Pincode.latitude, Pincode.longitude).where(
                        Pincode.code == coverage[0]
                    )
                )
            ).one()
            await technicians_service.set_base_location(
                db,
                actor_of[fid],
                profile.id,
                BaseLocationIn(latitude=float(lat), longitude=float(lng), source="map"),
            )
            await db.refresh(profile)
            based += 1
    report["bases set"] = based

    # -- speed: one node rule per franchisee, freelancers only --------------
    # Employees keep no rule on purpose, so the `speed: null` path is walked.
    # ⚠ Added as ORM rows, not through `core.speed_rules.upsert_rule`: that
    # function answers with `_one_out(row)`, which reads a `db` it is never
    # given (NameError after the write), so `PUT .../settings/speed` cannot
    # work. Found by Task 16, reported, not fixed (no feature code); switch this
    # to `upsert_rule(SpeedRuleIn(...))` when `_one_out` takes the session.
    first_node = next(iter(tenant.models_by_node))
    for s_ in seeds:
        db.add(
            FranchiseeSpeedRule(
                company_id=company_id,
                franchisee_id=s_.id,
                technician_type="freelancer",
                node_id=first_node,
                reward_within_hours=SPEED_REWARD_WITHIN_H,
                penalty_after_hours=SPEED_PENALTY_AFTER_H,
                reward_paise=SPEED_REWARD_PAISE,
                penalty_paise=SPEED_PENALTY_PAISE,
                created_by=actor_of[s_.id].user_id,
                updated_by=actor_of[s_.id].user_id,
            )
        )
    await db.commit()

    # -- parts: a list on the first category and its first product ----------
    ids: list[uuid.UUID] = []
    for name in PARTS_ON_CATEGORY:
        added = await parts_service.add_part(
            db, admin, SparePartCreate(name=name), node_id=first_node
        )
        ids.append(added.id)
    tenant.parts_by_node[first_node] = ids
    first_model = tenant.models_by_node[first_node][0][0]
    await parts_service.add_part(
        db, admin, SparePartCreate(name=PART_ON_MODEL), model_id=first_model
    )

    # -- facility: one operator at home and at Crestline, none at Northgate --
    # Owner ruling 2026-10-15 (R4): nobody in the staff shell works the parts
    # queue, so a franchisee with no facility staff answers a request with
    # 409 NO_FACILITY — Northgate is left that way on purpose.
    for s, mailbox, phone_index in (
        (seeds[0], f"facility.{low}", 900_000_010),
        (seeds[1], f"facility.crest.{low}", 900_000_011),
    ):
        await create_facility_user(
            db,
            actor=actor_of[s.id],
            franchisee_id=s.id,
            body=FacilityUserCreateRequest(
                fullName=f"Facility Operator {s.code}",
                email=synthetic_email(mailbox),
                phone=synthetic_phone(phone_index),
                role="facility_operator",
            ),
        )
        s.facility = await principal_for(
            db,
            await _user_by_email(db, synthetic_email(mailbox)),
            company_id=company_id,
            franchisee_id=s.id,
        )
    tenant.setup_report = report


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
