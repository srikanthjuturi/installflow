"""Task 05 §7 seed — the acceptance cast, built through the real services.

    python -m app.scripts.seed_task05            # find-or-create on dev DB
    python -m app.scripts.seed_task05 --reset    # drop our logins, rebuild

Everything here is created BY the product (create_company, create_franchisee,
create_technician, add_admin …), never by an INSERT — the same rule
`seed_demo` follows, because §7 is acceptance, not fixtures: if a step cannot
be driven the way a person drives it, that is a breach to fix, not a fact to
paper over with a row.

Company A is the **Seed Appliances** company Tasks 00-04 already ran against;
our franchisees, staff and technicians carry deterministic `T05` tags so a
second run finds and REUSES them (find-or-create, no rebuild) instead of
colliding on unique indexes. Company B is built fresh for §7 #4 and #11's
cross-tenant 404s — a company, its home and one admin, nothing more.

The cast (§7):

  company A (Seed Appliances) — home H, external S "SkyFix Services", a second
      franchisee T, one vendor to raise tickets, one product to certify against
      Priya — S's admin      Uma — T's admin      Hari — H's franchisee admin
      Kiran — A's Area Manager whose state holds S's pincodes
      Nisha — A's National Head
  company B — its own admin, and Bala as ITS home's franchisee admin
  Ravi — S's technician, registered BY Priya (§7 #2), born a FREELANCER —
      Task 06 §7's cast ("Ravi = S freelancer"); Task 05's walk #7 may find an
      older employee row on a dev DB and flips him itself either way
  Hema — H's technician, registered by A's staff
  Meena — S's other technician, registered BY Priya, born an EMPLOYEE — the one
      whose month becomes a statement (Task 06 §7)

The money flows (§7 #10-#14) are deliberately NOT seeded — a charge written by
an INSERT would prove nothing. The tests drive them through the same services
a phone and the console drive. ONE exception, Task 06 §7: Meena carries
employee-stream ledger rows, written through the product too (a cancellation,
a bonus, a reversal — `_ensure_statement_money` below), so
`GET /franchise/statements/{meena}?month=` answers on a dev database without
somebody first driving a whole ticket walk by hand. The rows are written the
same way the tests write theirs, and they accumulate only once: a month with
rows is left alone, so a re-run cannot double Meena's money.
"""

import argparse
import asyncio
import dataclasses
import datetime
import hashlib
import sys
import uuid

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from fastapi import BackgroundTasks  # noqa: E402
from sqlalchemy import delete, select, update  # noqa: E402

from app.core.database import AsyncSessionLocal  # noqa: E402
from app.core.deps import Principal  # noqa: E402
from app.core.errors import AppError  # noqa: E402
from app.core.franchise import home_franchisee_id  # noqa: E402
from app.core.ledger import IST  # noqa: E402
from app.core.slots import bookable_slots  # noqa: E402
from app.core.vendor_credits import standing as vendor_standing  # noqa: E402
from app.features.companies import service as companies_service  # noqa: E402
from app.features.companies.schemas import CompanyCreateRequest  # noqa: E402
from app.features.franchisees import service as franchisees_service  # noqa: E402
from app.features.franchisees.schemas import (  # noqa: E402
    FranchiseeAdminIn,
    FranchiseeCreateRequest,
    PincodesRequest,
)
from app.features.jobs import service as jobs_service  # noqa: E402
from app.features.ledger import service as ledger_service  # noqa: E402
from app.features.masters import service as masters_service  # noqa: E402
from app.features.masters.schemas import (  # noqa: E402
    ModelCreateRequest,
    NodeCreateRequest,
)
from app.features.technicians import service as technicians_service  # noqa: E402
from app.features.technicians.schemas import (  # noqa: E402
    TechnicianCreateRequest,
    TechnicianUpdateRequest,
)
from app.features.tickets import feedback_service  # noqa: E402
from app.features.tickets import service as tickets_service  # noqa: E402
from app.features.tickets.schemas import TicketCreateRequest  # noqa: E402
from app.features.tickets.sweeps import sweep_unaccepted  # noqa: E402
from app.features.users import service as users_service  # noqa: E402
from app.features.users.schemas import UserCreateRequest  # noqa: E402
from app.features.vendors import service as vendors_service  # noqa: E402
from app.features.vendors.schemas import (  # noqa: E402
    VendorCreateRequest,
    VendorUpdateRequest,
)
from app.models.company import Company  # noqa: E402
from app.models.credits import CreditRecharge  # noqa: E402
from app.models.franchisee import Franchisee, FranchiseePincode  # noqa: E402
from app.models.ledger import LedgerEntry  # noqa: E402
from app.models.membership import Membership  # noqa: E402
from app.models.product import ProductModel, ProductNode  # noqa: E402
from app.models.role import (  # noqa: E402
    ADMIN,
    AREA_MANAGER,
    FRANCHISEE_ADMIN,
    NATIONAL_HEAD,
    ROLE_RANKS,
    SUPERADMIN,
)
from app.models.technician import TechnicianPincode, TechnicianProfile  # noqa: E402
from app.models.ticket import Ticket  # noqa: E402
from app.models.territory import MembershipState, Pincode, Region, State  # noqa: E402
from app.models.user import User  # noqa: E402
from app.models.vendor import Vendor  # noqa: E402
from app.models.vendor_brand import VendorBrand  # noqa: E402
from app.scripts.seed.guards import (  # noqa: E402
    SeedRefused,
    synthetic_email,
    synthetic_phone,
)
from app.scripts.seed.lifecycle import _artifacts as seed_artifacts  # noqa: E402
from app.scripts.seed.tenant import phone_block, top_up_credits  # noqa: E402

TAG = "t05"
COMPANY_A_LIKE = "Seed Appliances%"
COMPANY_B_NAME = "T05 Company B"

S_NAME, S_CODE = "SkyFix Services", "T05S"
T_NAME, T_CODE = "Second Partner", "T05T"
#: S gets five codes in ONE state (so Priya's create needs no `regionId` and
#: Kiran's area can hold every one); Hema gets three more of the SAME state.
#: Those three are unclaimed — no live franchisee's `franchisee_pincodes` row
#: mentions them — so they route HOME, which is what makes Hema a home
#: technician to every staff reader (§7 #5, #12), while Ravi stays inside
#: Kiran's territory.
S_CODES_N, HEMA_CODES_N = 5, 3

PRIYA_EMAIL = synthetic_email(f"{TAG}.priya")
HARI_EMAIL = synthetic_email(f"{TAG}.hari")
UMA_EMAIL = synthetic_email(f"{TAG}.uma")
BALA_EMAIL = synthetic_email(f"{TAG}b.bala")
KIRAN_EMAIL = synthetic_email(f"{TAG}.kiran")
NISHA_EMAIL = synthetic_email(f"{TAG}.nisha")
VENDOR_EMAIL = synthetic_email(f"{TAG}.vendor")

VENDOR_NAME = "T05 Depot Vendor"
ROOT_NAME = "T05 Appliances"
CATEGORY_NAME = "T05 Large Appliances"
LEAF_NAME = "T05 Washing Machines"
MODEL_NAME = "T05 Front Load Washer"
SERVICE_TYPES = ["Installation + Demo", "Service"]

#: Two inventable numbers on this task's own block — `phone_block` derives a
#: stable 100k span from the tag, so a re-run cannot collide on
#: `uq_users_phone_technician` and never touches the demo's real team phones.
BLOCK = phone_block("t05-integration")
RAVI_PHONE = synthetic_phone(BLOCK + 1)
HEMA_PHONE = synthetic_phone(BLOCK + 2)
MEENA_PHONE = synthetic_phone(BLOCK + 3)

RAVI_UPI = "ravit05@ybl"
HEMA_UPI = "hemat05@ybl"
MEENA_UPI = "meenat05@ybl"

#: Meena's escalation bonus, funded through `add_bonus_and_renotify` — ₹400,
#: the worked example's figure (06-employees.md §1).
MEENA_BONUS_PAISE = 40_000


@dataclasses.dataclass
class World:
    """Everything a §7 acceptance test needs, as ids and locators only.

    No ORM objects on purpose: every test segment opens its OWN session, and a
    principal built across sessions is a detached `user` the moment the build
    transaction expires its attributes. Tests resolve people by email in the
    session they act from, exactly as `seed_demo` looks its cast up again.
    """

    company_a_id: uuid.UUID
    company_a_admin_email: str
    home_id: uuid.UUID  # H
    s_id: uuid.UUID  # S — SkyFix Services
    t_id: uuid.UUID  # T — the second franchisee
    company_b_id: uuid.UUID
    home_b_id: uuid.UUID

    priya_email: str
    hari_email: str
    uma_email: str
    bala_email: str
    kiran_email: str
    nisha_email: str
    company_b_admin_email: str
    vendor_email: str
    vendor_id: uuid.UUID

    region_id: uuid.UUID
    state_id: uuid.UUID
    s_pincodes: list[str]
    hema_pincodes: list[str]

    leaf_id: uuid.UUID
    model_id: uuid.UUID
    service_types: list[str]

    ravi_phone: str
    hema_phone: str
    meena_phone: str

    ravi_id: uuid.UUID  # TechnicianProfile id — S's technician (freelancer)
    hema_id: uuid.UUID  # TechnicianProfile id — H's technician (employee)
    meena_id: uuid.UUID  # TechnicianProfile id — S's employee (Task 06)


async def principal_by_email(db, email: str, company_id) -> Principal:
    """The person behind one of this file's addresses, resolved FRESH.

    A principal is worthless carried across sessions — its `user` is an ORM
    row the calling test's session did not load — so nothing is cached here.
    A franchise admin's `franchisee_id` comes from their live membership, the
    same fact `get_current_principal` reads — a hand-built principal that
    omits it stamps the HOME, which is exactly the leak this task's wall
    exists to prevent.
    """
    user = await db.scalar(select(User).where(User.email == email.lower()))
    if user is None:
        raise SeedRefused(f"No account for {email} — the cast is not seeded.")
    franchisee_id = None
    if user.role == FRANCHISEE_ADMIN:
        franchisee_id = await db.scalar(
            select(Membership.franchisee_id).where(
                Membership.company_id == company_id,
                Membership.user_id == user.id,
                Membership.deleted_at.is_(None),
            )
        )
    return Principal(
        user=user,
        role=user.role,
        rank=ROLE_RANKS[user.role],
        is_superadmin=False,
        company_id=company_id,
        franchisee_id=franchisee_id,
    )


async def technician_principal(
    db, profile_id: uuid.UUID, company_id: uuid.UUID
) -> Principal:
    """Ravi or Hema, as the app itself puts them at the door: role TECHNICIAN
    over their membership's company."""
    user_id = await db.scalar(
        select(User.id)
        .join(Membership, Membership.user_id == User.id)
        .join(TechnicianProfile, TechnicianProfile.membership_id == Membership.id)
        .where(
            TechnicianProfile.id == profile_id,
            TechnicianProfile.company_id == company_id,
            Membership.company_id == company_id,
            Membership.deleted_at.is_(None),
        )
    )
    if user_id is None:
        raise SeedRefused(f"No technician user behind profile {profile_id}.")
    user = await db.get(User, user_id)
    return Principal(
        user=user,
        role=user.role,
        rank=ROLE_RANKS[user.role],
        is_superadmin=False,
        company_id=company_id,
    )


# ── small finders ────────────────────────────────────────────────────────


async def _user_by_email(db, email: str) -> User:
    user = await db.scalar(select(User).where(User.email == email.lower()))
    if user is None:
        raise SeedRefused(f"No account for {email} — seeding stopped.")
    return user


async def _principal_for(db, user: User, company_id) -> Principal:
    return Principal(
        user=user,
        role=user.role,
        rank=ROLE_RANKS[user.role],
        is_superadmin=False,
        company_id=company_id,
    )


async def _franchisee_by_code(db, company_id: uuid.UUID, code: str) -> Franchisee | None:
    return await db.scalar(
        select(Franchisee).where(
            Franchisee.company_id == company_id,
            Franchisee.code == code,
            Franchisee.deleted_at.is_(None),
        )
    )


async def _stored_codes(db, franchisee_id: uuid.UUID) -> list[str]:
    return [
        r[0]
        for r in sorted(
            await db.execute(
                select(FranchiseePincode.pincode).where(
                    FranchiseePincode.franchisee_id == franchisee_id
                )
            )
        )
    ]


async def _claimed_codes(db, company_id) -> set[str]:
    return set(
        await db.scalars(
            select(FranchiseePincode.pincode).where(
                FranchiseePincode.company_id == company_id
            )
        )
    )


async def _region_id(db) -> uuid.UUID:
    """The seed geography's region — the one `tenant.py`'s cast lives in."""
    region_id = await db.scalar(select(Region.id).where(Region.name == "South"))
    if region_id is None:
        region_id = await db.scalar(select(Region.id).limit(1))
    if region_id is None:
        raise SeedRefused("No region rows — the geography master is not loaded.")
    return region_id


async def _codes_for_state(db, company_id, state_id) -> list[str]:
    """Active codes of this state, minus what a live franchisee already holds."""
    claimed = await _claimed_codes(db, company_id)
    rows = await db.scalars(
        select(Pincode.code)
        .where(Pincode.state_id == state_id, Pincode.is_active.is_(True))
        .order_by(Pincode.code)
    )
    return [c for c in rows if c not in claimed]


async def _choose_state(db, region_id: uuid.UUID, company_id) -> State:
    """The state of `region` with enough unclaimed active pincodes.

    Two franchises live off the same handful of codes here, so the choice is by
    abundance: the demo's own claims (a SOUTH over 500001-500099, for one) may
    have thinned some. Ties break by name so the pick is stable across runs.
    """
    states = (
        await db.scalars(
            select(State)
            .join(Pincode, Pincode.state_id == State.id)
            .where(State.region_id == region_id, Pincode.is_active.is_(True))
            .group_by(State.id)
            .order_by(State.name)
        )
    ).all()
    # A state belongs to one area manager per company (users service, 409), so
    # Kiran can only take a state no other AM of company A already holds.
    taken_by_am = set(
        await db.scalars(
            select(MembershipState.state_id)
            .join(Membership, Membership.id == MembershipState.membership_id)
            .join(User, User.id == Membership.user_id)
            .where(
                Membership.company_id == company_id,
                User.role == AREA_MANAGER,
                User.deleted_at.is_(None),
            )
        )
    )
    for state in states:
        if state.id in taken_by_am:
            continue
        if len(await _codes_for_state(db, company_id, state.id)) >= (
            S_CODES_N + HEMA_CODES_N
        ):
            return state
    raise SeedRefused(
        "No state in the seed region has eight unclaimed active pincodes — "
        "delete leftover IntTest franchisees, or load more geography."
    )


def _gst(tag: str) -> str:
    """A well-formed, nobody-else's GSTIN derived stably from `tag`.

    `36` is Telangana; the five letters come from the digest so distinct tags
    never share a registration, and stably, so the same tag re-deriving the
    same number means a re-run is refused as a duplicate rather than quietly
    minting a second company that looks identical.
    """
    digest = hashlib.md5(tag.encode()).hexdigest()
    digits = f"{int(digest[8:12], 16) % 10_000:04d}"
    letters = "".join(chr(ord("A") + int(digest[i], 16) % 26) for i in range(5))
    return f"36{letters}{digits}A1Z5"


def _ranges(codes: list[str]) -> str:
    """The list box's grammar: entries separated by commas (F2's parser
    accepts six-digit codes and `a-b` spans alike)."""
    return ",".join(codes)


async def _profile_by_phone(db, company_id, phone: str) -> TechnicianProfile | None:
    return await db.scalar(
        select(TechnicianProfile)
        .join(Membership, Membership.id == TechnicianProfile.membership_id)
        .join(User, User.id == Membership.user_id)
        .where(
            TechnicianProfile.company_id == company_id,
            User.phone == phone,
            User.deleted_at.is_(None),
        )
    )


async def _technician_codes(db, profile_id) -> list[str]:
    return list(
        await db.scalars(
            select(TechnicianPincode.pincode).where(
                TechnicianPincode.technician_id == profile_id
            )
        )
    )


async def _realign_coverage(
    db, principal, profile: TechnicianProfile, desired: list[str]
) -> None:
    """A rebuild may have moved S's codes (a reset hands the cast a fresh
    state) — a technician found on the phone still carries the OLD codes.

    Re-drive coverage through the ordinary PUT: `pincodes` alone replaces the
    set, and with `regionId` absent the service skips region resolution, so
    Priya's franchisee wall is the only check — and the desired codes ARE S's
    coverage, so it passes."""
    # Drift repair BEFORE the PUT: the profile may still be stamped to a
    # franchisee an older `--reset` soft-deleted, and the franchisee wall reads
    # `profile.franchisee_id` — Priya would 404 on her own technician forever,
    # with no product route left to fix it. Only a DEAD target is repaired
    # here; a LIVE miss is a genuine inconsistency and stops the seeder.
    if principal.is_franchise and profile.franchisee_id != principal.franchisee_id:
        deleted = await db.scalar(
            select(Franchisee.deleted_at).where(Franchisee.id == profile.franchisee_id)
        )
        if deleted is not None:
            profile.franchisee_id = principal.franchisee_id
            # The session runs without autoflush — the PUT's SELECT must see
            # the repaired stamp.
            await db.flush()
        else:
            raise SeedRefused(
                f"Technician {profile.id} is stamped to a live franchisee "
                f"{profile.franchisee_id} the acting principal is not on — "
                "repair by hand."
            )
    if sorted(await _technician_codes(db, profile.id)) == sorted(desired):
        return
    await technicians_service.update_technician(
        db, principal, profile.id, TechnicianUpdateRequest(pincodes=desired)
    )


async def _node_id(db, company_id, parent_id, name) -> uuid.UUID:
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
        raise SeedRefused(f"The category {name!r} is missing — seeding stopped.")
    return node_id


# ── the cast builders ───────────────────────────────────────────────────


async def _ensure_admin(db, principal, franchisee_id, email, full_name, phone) -> None:
    """This franchisee's admin, if they are not already on file.

    The identity walk is `create_login`'s, so the reuse case goes through it
    too: a person whose account exists (after --reset removed the membership)
    is re-linked by a membership row alone, no password minted.
    """
    from app.core.franchise_logins import create_login, mail_password

    existing = await db.scalar(select(User).where(User.email == email.lower()))
    if existing is not None:
        on_file = await db.scalar(
            select(Membership).where(
                Membership.company_id == principal.company_id,
                Membership.franchisee_id == franchisee_id,
                Membership.user_id == existing.id,
                Membership.deleted_at.is_(None),
            )
        )
        if on_file is not None:
            if existing.role == FRANCHISEE_ADMIN:
                return
            raise SeedRefused(
                f"{email} exists as {existing.role}, not a franchisee admin — "
                "run --reset, or seed the cast with a new tag."
            )
        # An account an earlier run left with the WRONG role (our own reset
        # removed its memberships, so nobody anywhere still holds it) is
        # adopted onto the requested role; an account somebody else still
        # uses hits create_login's readable 409, which is the honest wall.
        if existing.role != FRANCHISEE_ADMIN:
            used_elsewhere = await db.scalar(
                select(Membership.id)
                .where(
                    Membership.user_id == existing.id,
                    Membership.deleted_at.is_(None),
                )
                .limit(1)
            )
            if used_elsewhere is None:
                existing.role = FRANCHISEE_ADMIN
    login = await create_login(
        db,
        company_id=principal.company_id,
        franchisee_id=franchisee_id,
        role=FRANCHISEE_ADMIN,
        full_name=full_name,
        email=email,
        phone=phone,
        actor_id=principal.user_id,
    )
    await mail_password(
        db, company_id=principal.company_id, user=login.user,
        temporary_password=login.temporary_password,
    )


async def _ensure_staff(db, admin, email, full_name, role, *, phone,
                        state_ids=(), region_ids=()) -> uuid.UUID:
    """One console person, find-or-created; returns their user id."""
    user = await db.scalar(select(User).where(User.email == email.lower()))
    if user is None:
        await users_service.create_user(
            db, admin,
            UserCreateRequest(
                email=email, fullName=full_name, phone=phone, role=role,
                regionIds=list(region_ids), stateIds=list(state_ids),
            ),
        )
        user = await _user_by_email(db, email)
    return user.id


async def _ensure_vendor(db, company_id, admin) -> uuid.UUID:
    vendor = await db.scalar(
        select(Vendor).where(
            Vendor.company_id == company_id,
            Vendor.name == VENDOR_NAME,
            Vendor.deleted_at.is_(None),
        )
    )
    if vendor is not None:
        return vendor.id
    created = await vendors_service.create_vendor(
        db, admin,
        VendorCreateRequest(
            name=VENDOR_NAME,
            gstNumber=_gst("t05v"),
            pan=_gst("t05v")[2:12],
            contactPerson="Tanmay Dutta",
            phone=synthetic_phone(BLOCK + 41),
            address="Shed 8, T05 Distribution Park",
            city="Hyderabad",
            state="Telangana",
            pincode="500081",
            loginEmail=VENDOR_EMAIL,
            brands=["Meridian", "Sunview"],
            # ON, the product's own default: the live proof photo is
            # location-gated, and a seeded artifact satisfies it honestly by
            # sending a device pincode that matches the ticket's.
            locationCheckEnabled=True,
        ),
    )
    return created.id


async def _ensure_model(db, company_id, admin, vendor_id) -> uuid.UUID:
    """The product Ravi and Hema are both certified on."""
    return await _leaf_and_model(db, company_id, admin, vendor_id)


async def _leaf_and_model(db, company_id, admin, vendor_id) -> tuple[uuid.UUID, uuid.UUID]:
    """Find-or-create each level — a failed earlier run left the root behind.
    ⚠ `create_model` answers with the whole TREE, so its row is found by the
    name it was given — the same `_model_id` walk tenant.py makes."""
    model_id = await db.scalar(
        select(ProductModel.id).where(
            ProductModel.company_id == company_id,
            ProductModel.name == MODEL_NAME,
            ProductModel.deleted_at.is_(None),
        )
    )
    leaf_id = await db.scalar(
        select(ProductNode.id).where(
            ProductNode.company_id == company_id,
            ProductNode.name == CATEGORY_NAME,
            ProductNode.deleted_at.is_(None),
        )
    )
    if model_id is not None:
        return leaf_id, model_id

    existing_leaf = leaf_id
    if existing_leaf is None:
        root_id = await db.scalar(
            select(ProductNode.id).where(
                ProductNode.company_id == company_id,
                ProductNode.name == ROOT_NAME,
                ProductNode.deleted_at.is_(None),
            )
        )
        if root_id is None:
            await masters_service.create_node(
                db, admin, NodeCreateRequest(name=ROOT_NAME, isLeaf=False)
            )
            root_id = await _node_id(db, company_id, None, ROOT_NAME)
        await masters_service.create_node(
            db, admin, NodeCreateRequest(name=CATEGORY_NAME, parentId=root_id, isLeaf=True)
        )
        leaf_id = await _node_id(db, company_id, root_id, CATEGORY_NAME)
        await masters_service.create_node(
            db, admin, NodeCreateRequest(name=CATEGORY_NAME, parentId=root_id, isLeaf=True)
        )
        leaf_id = await _node_id(db, company_id, root_id, CATEGORY_NAME)

    brand_id = await db.scalar(
        select(VendorBrand.id).where(
            VendorBrand.vendor_id == vendor_id, VendorBrand.name == "Meridian"
        )
    )
    await masters_service.create_model(
        db, admin, leaf_id,
        ModelCreateRequest(
            name=MODEL_NAME, vendorId=vendor_id, brandId=brand_id,
            serviceTypes=SERVICE_TYPES,
            technicianPayoutPaise=60_000,  # ₹600
            vendorPricePaise=180_000,  # ₹1,800
        ),
    )
    model_id = await db.scalar(
        select(ProductModel.id).where(
            ProductModel.company_id == company_id,
            ProductModel.name == MODEL_NAME,
            ProductModel.deleted_at.is_(None),
        )
    )
    return leaf_id, model_id


async def _superadmin_user(db) -> User:
    user = await db.scalar(select(User).where(User.role == SUPERADMIN).limit(1))
    if user is None:
        raise SeedRefused("No superadmin — run `python -m app.scripts.bootstrap`.")
    return user


def _company_b_request() -> CompanyCreateRequest:
    return CompanyCreateRequest(
        name=COMPANY_B_NAME,
        code=None,
        email=synthetic_email(f"{TAG}b.admin"),
        phone=synthetic_phone(BLOCK + 51),
        adminName="T05 Company B Admin",
        gstNumber=_gst("t05b"),
        pan=_gst("t05b")[2:12],
        gstCompanyStatus="Active",
        addressLine1="Plot 1, T05 Business Park",
        city="Hyderabad",
        state="Telangana",
        pincode="500081",
    )


async def ensure_credits(db, admin, owner) -> None:
    """Recharge company A once; a second run must not double the credits."""
    has_one = await db.scalar(
        select(CreditRecharge.id)
        .where(CreditRecharge.company_id == admin.company_id)
        .limit(1)
    )
    if has_one is not None:
        return
    from app.core.credits import load_platform_settings

    platform = await load_platform_settings(db)
    await top_up_credits(
        db, admin=admin, credits=12 * platform.ticket_credits, owner=owner
    )


async def _ensure_technicians(
    db, company_id, admin, priya, s_id, leaf_id, region_id, *,
    s_pincodes, hema_pincodes,
):
    """Ravi and Meena (by Priya, through the portal door) and Hema (by staff).

    None are given `regionId`: Priya must not need one — her franchisee's codes
    sit in ONE region, which is the point of picking S's codes by state — while
    the staff door HAS to be told (an admin is all-India, so the service can no
    longer infer). Hema's codes route home because nobody claims them.

    Types are Task 06 §7's cast: **Ravi a freelancer, Meena an employee,
    Hema an employee.** Ravi used to be born an employee (Task 05's walk #7
    made him a freelancer halfway through); on a dev DB an older seed row may
    still say employee, so he is flipped through the ordinary PUT — and if the
    product refuses (leftover open jobs from an interrupted run), the walk's
    own #7 does the flip later; the seed only stops saying the wrong thing on
    a fresh database.
    """
    ravi = await _profile_by_phone(db, company_id, RAVI_PHONE)
    if ravi is None:
        created = await technicians_service.create_technician(
            db, priya,
            TechnicianCreateRequest(
                fullName="Ravi Kumar", phone=RAVI_PHONE,
                subcategoryIds=[leaf_id], pincodes=s_pincodes,
                technicianType="freelancer", upiId=RAVI_UPI, upiName="Ravi Kumar",
            ),
        )
        ravi_id = created.id
    else:
        ravi_id = ravi.id
        await _realign_coverage(db, priya, ravi, s_pincodes)
        await db.refresh(ravi)
        if ravi.technician_type != "freelancer":
            try:
                await technicians_service.update_technician(
                    db, priya, ravi_id,
                    TechnicianUpdateRequest(technicianType="freelancer"),
                )
            except AppError as exc:
                print(
                    f"    note: Ravi stays {ravi.technician_type!r} for now "
                    f"({exc.code}); the money walk's type switch makes him a "
                    "freelancer."
                )

    hema = await _profile_by_phone(db, company_id, HEMA_PHONE)
    if hema is None:
        created = await technicians_service.create_technician(
            db, admin,
            TechnicianCreateRequest(
                fullName="Hema Nair", phone=HEMA_PHONE, regionId=region_id,
                subcategoryIds=[leaf_id], pincodes=hema_pincodes,
                technicianType="employee", upiId=HEMA_UPI, upiName="Hema Nair",
            ),
        )
        hema_id = created.id
    else:
        hema_id = hema.id
        await _realign_coverage(db, admin, hema, hema_pincodes)

    meena = await _profile_by_phone(db, company_id, MEENA_PHONE)
    if meena is None:
        created = await technicians_service.create_technician(
            db, priya,
            TechnicianCreateRequest(
                fullName="Meena Raghavan", phone=MEENA_PHONE,
                subcategoryIds=[leaf_id], pincodes=s_pincodes,
                # The statement's owner. Her UPI stays on file the way every
                # seeded profile's does; as an employee she can never redeem
                # (Task 06 T4), so the field is dormant until §7 #7's switch.
                technicianType="employee", upiId=MEENA_UPI,
                upiName="Meena Raghavan",
            ),
        )
        meena_id = created.id
    else:
        meena_id = meena.id
        await _realign_coverage(db, priya, meena, s_pincodes)

    return ravi_id, hema_id, meena_id


#: Room bought on the vendor's credit line before the walk raises its tickets —
#: the same figure the acceptance test's `ensure_vendor_headroom` uses, for the
#: same reason: an earlier run's leftovers ride on the ₹5,000 the vendor was
#: born with, and the refusal would be the PRODUCT behaving right.
_HEADROOM_PAISE = 10_000_000


async def _ensure_statement_money(
    db, *, company_id, vendor_id, leaf_id, model_id,
    admin, priya, kiran, meena_id,
) -> None:
    """Meena's employee-stream month, written through the product (Task 06 §7).

    The worked example's three rows, the same way a real week writes them:

      * a job accepted and CANCELLED inside the 2-4h band → `penalty` ₹500 in
        the EMPLOYEE stream, charged against S's pool;
      * an escalated job with a ₹400 bonus funded on the escalation screen,
        which Meena completes → `bonus` ₹400 — and NO `payout` row, because
        T2 pays an employee through salary and the completion itself is the
        proof on a dev database;
      * Priya giving the cancellation penalty back → `reversal` ₹500, stamped
        by copying the penalty's stream, not by re-reading her profile.

    Downloading `GET /franchise/statements/{meena}?month=` for the current IST
    month then answers with net +₹400.00 — §1's worked example, live.

    Once only: any employee-stream row of Meena's means the month exists and
    the walk leaves it alone (idempotent re-runs, and a month that never
    changes is what lets payroll trust it). A walk caught between steps by a
    crash leaves a partial month — which is a real month, the same way.

    The clock is the one thing no service offers a writer: a slot must sit
    2-4h ahead for the dearest cancellation band below no-show, so the two
    tickets' slots are moved by a raw UPDATE before anyone accepts — the same
    move `tests/integration` makes, and the same reason.
    """
    has_rows = await db.scalar(
        select(LedgerEntry.id)
        .where(
            LedgerEntry.company_id == company_id,
            LedgerEntry.technician_id == meena_id,
            LedgerEntry.technician_type == "employee",
        )
        .limit(1)
    )
    if has_rows is not None:
        return
    meena = await db.get(TechnicianProfile, meena_id, populate_existing=True)
    codes = list(
        await db.scalars(
            select(TechnicianPincode.pincode).where(
                TechnicianPincode.technician_id == meena_id
            )
        )
    )
    if not codes:
        raise SeedRefused(
            "Meena holds no pincodes — nothing can be raised against her."
        )

    # Room on the vendor's line, and the vendor principal that raises.
    line = await vendor_standing(db, company_id, vendor_id)
    needed = line.used_paise + line.reserved_paise + _HEADROOM_PAISE
    if line.limit_paise < needed:
        await vendors_service.update_vendor(
            db, admin, vendor_id, VendorUpdateRequest(creditLimitPaise=needed)
        )
    vendor_user = await _user_by_email(db, VENDOR_EMAIL)
    vendor = Principal(
        user=vendor_user, role=vendor_user.role, rank=0, is_superadmin=False,
        company_id=company_id, vendor_id=vendor_id,
    )

    def _soon(h: int) -> datetime.datetime:
        return datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(
            hours=h
        )

    async def _raise(index: int) -> Ticket:
        body = TicketCreateRequest(
            subcategoryId=leaf_id,
            modelId=model_id,
            serviceType=SERVICE_TYPES[0],
            serialNumber=f"T05S{index:06d}{uuid.uuid4().hex[:4].upper()}",
            customerName="Acceptance Customer",
            customerPhone=synthetic_phone(BLOCK + 60 + index),
            address=f"Flat {index}, Green Park Residency",
            city="Hyderabad", state="Telangana", pincode=codes[0],
            expectedDate=(
                datetime.datetime.now(datetime.timezone.utc).date()
                + datetime.timedelta(days=1)
            ),
            serviceLevelHours=48,
        )
        created = await tickets_service.create_ticket(db, vendor, body)
        row = await db.get(Ticket, created.id)
        windows = await bookable_slots(db, row)
        if not windows:
            raise SeedRefused(f"No slot windows offered for ticket {row.code}.")
        # The customer picks the earliest window, as the acceptance walk does.
        await tickets_service.confirm_slot(db, row.slot_token, windows[0][0])
        await db.refresh(row)
        return row

    # (a) the penalty — accepted, then cancelled inside the 2-4h band.
    row = await _raise(1)
    await db.execute(
        update(Ticket).where(Ticket.id == row.id).values(
            slot_start=_soon(3), slot_end=_soon(4)
        )
    )
    await db.commit()  # the PUT below reads the slot from the row in THIS db
    await jobs_service.accept(
        db, row.id, company_id=company_id, profile=meena,
        background=BackgroundTasks(),
    )
    await db.refresh(row)
    penalty_ticket_id = row.id
    await jobs_service.cancel(
        db, row.id, company_id=company_id, profile=meena,
        reason="Vehicle breakdown on the way",
    )
    await db.refresh(row)

    # (b) the bonus — escalated empty, funded, accepted, completed and
    #     confirmed. `job_technician_type` reads EMPLOYEE, so `complete`
    #     settles the bonus and writes no payout (T2) — that silence is part
    #     of what the statement endpoint shows on dev.
    row = await _raise(2)
    await db.execute(
        update(Ticket).where(Ticket.id == row.id).values(
            slot_start=_soon(1), slot_end=_soon(2)
        )
    )
    await db.commit()
    await sweep_unaccepted(db)
    await db.refresh(row)
    if row.status != "Escalated":
        raise SeedRefused(
            f"Ticket {row.code} did not escalate ({row.status}) — the at-risk "
            "sweep did not claim it; the statement walk cannot fund a bonus."
        )
    await tickets_service.add_bonus_and_renotify(
        db, kiran, row.id, amount_paise=MEENA_BONUS_PAISE
    )
    await jobs_service.accept(
        db, row.id, company_id=company_id, profile=meena,
        background=BackgroundTasks(),
    )
    await db.refresh(row)
    await jobs_service.submit_proof(
        db, row.id, company_id=company_id, profile=meena,
        artifacts=seed_artifacts(company_id, row),
        observed_serial=row.serial_number, observed_serial_source="scanned",
    )
    await db.refresh(row)
    await jobs_service.complete(db, row.id, company_id=company_id, profile=meena)
    await db.refresh(row)
    if row.feedback_token:
        await feedback_service.record_feedback(
            db, row.feedback_token, confirmed=True, rating=5,
            comment="Seed: customer confirmed the visit.",
        )
        await db.refresh(row)

    # (c) the reversal — Priya gives HER pool's penalty back (Door 2). The
    #     row copies the penalty's employee stamp, so the reversal lands in
    #     the statement's credit column, exactly as §1 says.
    penalty = await db.scalar(
        select(LedgerEntry)
        .where(
            LedgerEntry.company_id == company_id,
            LedgerEntry.technician_id == meena_id,
            LedgerEntry.kind == "penalty",
            LedgerEntry.ticket_id == penalty_ticket_id,
            LedgerEntry.reverses_id.is_(None),
        )
        .order_by(LedgerEntry.created_at.desc())
    )
    if penalty is None:
        raise SeedRefused(
            "The cancellation charged ₹0 — the monthly penalty cap is spent on "
            "this company. Raise it on Rules Config, or wait for a fresh IST "
            "month, and re-run."
        )
    await ledger_service.reverse_entry(
        db, priya, penalty.id, "Customer moved the visit"
    )

    print(
        f"    statement: GET /franchise/statements/{meena_id}?month="
        f"{datetime.datetime.now(IST).strftime('%Y-%m')} - net +400.00 INR"
        " (bonus 400, penalty -500, penalty reversed +500)."
    )


async def reset(db) -> None:
    """Our logins' memberships, in FK order.

    The FRANCHISEES are deliberately NOT reset — S's stored codes are how the
    next build keeps Kiran's area, Ravi's coverage and the tickets they feed
    one story (deleting S would hand its cast a new state mid-life). Only the
    membership rows go, so every login path runs again.

    The technicians and every ticket they touch are DELIBERATELY left: they
    are money that has already been judged. This exists for the rare case the
    login layer is wrong.
    """
    for email in (PRIYA_EMAIL, HARI_EMAIL, UMA_EMAIL, BALA_EMAIL):
        user = await db.scalar(select(User).where(User.email == email.lower()))
        if user is None:
            continue
        # The technicians whose manager is one of these logins keep their
        # membership — but its `manager_id` points HERE, so free those first
        # or the FK refuses the delete. The vendor's login is DELIBERATELY
        # not reset: `_ensure_vendor` owns its row, but nobody re-links the
        # login the delete would strip, and the ticket raiser needs it.
        theirs = list(
            await db.scalars(
                select(Membership.id).where(Membership.user_id == user.id)
            )
        )
        if theirs:
            await db.execute(
                update(Membership)
                .where(Membership.manager_id.in_(theirs))
                .values(manager_id=None)
            )
            await db.execute(delete(Membership).where(Membership.user_id == user.id))
    await db.commit()
    print("  Reset our logins' memberships.")


async def build(db) -> World:
    """Find-or-create every cast member. One `World`, re-entrant, no flags."""
    # ── company A ─────────────────────────────────────────────────────────
    company_a = await db.scalar(
        select(Company).where(
            Company.name.like(COMPANY_A_LIKE), Company.deleted_at.is_(None)
        )
    )
    if company_a is None:
        raise SeedRefused(
            f"No company like {COMPANY_A_LIKE!r} — run "
            "`python -m app.scripts.seed_demo` first."
        )
    company_a_id = company_a.id
    company_admin = await _principal_for(
        db, await _user_by_email(db, company_a.email), company_a_id
    )
    home_id = await home_franchisee_id(db, company_a_id)

    # ── S: born with Priya; its state decides Kiran's area ────────────────
    s = await _franchisee_by_code(db, company_a_id, S_CODE)
    if s is None:
        s = await franchisees_service.create_franchisee(
            db, company_admin,
            FranchiseeCreateRequest(
                name=S_NAME, code=S_CODE, kind="external",
                contactName="Priya Sharma",
                contactPhone=synthetic_phone(BLOCK + 11),
                admin=FranchiseeAdminIn(
                    fullName="Priya Sharma", email=PRIYA_EMAIL,
                    phone=synthetic_phone(BLOCK + 21),
                ),
            ),
        )
    s_id = s.id

    if stored := await _stored_codes(db, s_id):
        s_pincodes = stored
        kirans_state_id = await db.scalar(
            select(Pincode.state_id).where(Pincode.code == s_pincodes[0])
        )
    else:
        kirans_state = await _choose_state(db, await _region_id(db), company_a_id)
        kirans_state_id = kirans_state.id
        codes = await _codes_for_state(db, company_a_id, kirans_state_id)
        s_pincodes = codes[:S_CODES_N]
        await franchisees_service.set_pincodes(
            db, company_admin, s_id,
            PincodesRequest(pincodeRanges=_ranges(s_pincodes)),
            dry_run=False,
        )
        s_pincodes = await _stored_codes(db, s_id)
        if not s_pincodes:
            raise SeedRefused("S took no pincodes — the range did not resolve.")

    region_id = await db.scalar(
        select(State.region_id).where(State.id == kirans_state_id)
    )
    hema_codes_pool = [
        c
        for c in await _codes_for_state(db, company_a_id, kirans_state_id)
        if c not in set(s_pincodes)
    ]
    hema_pincodes = hema_codes_pool[:HEMA_CODES_N]
    if len(hema_pincodes) < HEMA_CODES_N:
        raise SeedRefused("No home pincode left beside S's — the state is claimed.")

    # ── T — the second franchisee, born with Uma ──────────────────────────
    t = await _franchisee_by_code(db, company_a_id, T_CODE)
    if t is None:
        t = await franchisees_service.create_franchisee(
            db, company_admin,
            FranchiseeCreateRequest(
                name=T_NAME, code=T_CODE, kind="external",
                contactName="Uma Menon",
                contactPhone=synthetic_phone(BLOCK + 12),
                admin=FranchiseeAdminIn(
                    fullName="Uma Menon", email=UMA_EMAIL,
                    phone=synthetic_phone(BLOCK + 22),
                ),
            ),
        )
    t_id = t.id

    # ── home's admin, A's managers ────────────────────────────────────────
    await _ensure_admin(db, company_admin, home_id, HARI_EMAIL,
                        "Hari Iyer", synthetic_phone(BLOCK + 23))
    await _ensure_staff(
        db, company_admin, KIRAN_EMAIL, "Kiran Reddy", AREA_MANAGER,
        phone=synthetic_phone(BLOCK + 31), state_ids=[kirans_state_id],
    )
    # Kiran's area follows S's STORED codes, not the other way round — if a
    # past reset handed S a new state, an old MembershipState row would leave
    # his wall on the previous one. Rows only: staff territory is console
    # wiring, not a fact a person creates.
    kiran_membership_id = await db.scalar(
        select(Membership.id)
        .join(User, User.id == Membership.user_id)
        .where(
            User.email == KIRAN_EMAIL.lower(),
            Membership.company_id == company_a_id,
            User.role == AREA_MANAGER,
            Membership.deleted_at.is_(None),
        )
    )
    if kiran_membership_id is not None:
        held = list(
            await db.scalars(
                select(MembershipState.state_id).where(
                    MembershipState.membership_id == kiran_membership_id
                )
            )
        )
        if held != [kirans_state_id]:
            await db.execute(
                delete(MembershipState).where(
                    MembershipState.membership_id == kiran_membership_id
                )
            )
            db.add(
                MembershipState(
                    membership_id=kiran_membership_id,
                    company_id=company_a_id,
                    state_id=kirans_state_id,
                )
            )
    await _ensure_staff(
        db, company_admin, NISHA_EMAIL, "Nisha Kulkarni", NATIONAL_HEAD,
        phone=synthetic_phone(BLOCK + 32),
    )

    # ── company B, its home, and Bala ─────────────────────────────────────
    b = await db.scalar(
        select(Company)
        .where(Company.name == COMPANY_B_NAME, Company.deleted_at.is_(None))
    )
    if b is None:
        b = await companies_service.create_company(
            db,
            Principal(
                user=await _superadmin_user(db), role=SUPERADMIN,
                rank=ROLE_RANKS[SUPERADMIN], is_superadmin=True, company_id=None,
            ),
            _company_b_request(),
        )
    company_b_id = b.id
    b_admin = await _principal_for(db, await _user_by_email(db, b.email), company_b_id)
    home_b_id = await home_franchisee_id(db, company_b_id)
    await _ensure_admin(db, b_admin, home_b_id, BALA_EMAIL,
                        "Bala Rao", synthetic_phone(BLOCK + 24))

    # ── the vendor that raises every ticket, the catalogue, credits ───────
    vendor_id = await _ensure_vendor(db, company_a_id, company_admin)
    leaf_id, model_id = await _leaf_and_model(db, company_a_id, company_admin, vendor_id)
    owner = Principal(
        user=await _superadmin_user(db), role=SUPERADMIN, rank=0,
        is_superadmin=True, company_id=company_a_id,
    )
    try:
        await ensure_credits(db, company_admin, owner)
    except SeedRefused as exc:
        print(f"    note: {exc}")

    # ── the two technicians ───────────────────────────────────────────────
    await db.commit()  # structure first — the profiles hang off every row above
    priya = await principal_by_email(db, PRIYA_EMAIL, company_a_id)
    ravi_id, hema_id, meena_id = await _ensure_technicians(
        db, company_a_id, company_admin, priya, s_id, leaf_id, region_id,
        s_pincodes=s_pincodes, hema_pincodes=hema_pincodes,
    )

    # Task 06 §7 — the statement's month, written through the product. Kiran
    # funds the bonus because the escalated job sits in HIS state, the same
    # desk the escalation queue puts it on.
    await _ensure_statement_money(
        db, company_id=company_a_id, vendor_id=vendor_id,
        leaf_id=leaf_id, model_id=model_id, admin=company_admin, priya=priya,
        kiran=await principal_by_email(db, KIRAN_EMAIL, company_a_id),
        meena_id=meena_id,
    )

    return World(
        company_a_id=company_a_id,
        company_a_admin_email=company_a.email,
        home_id=home_id,
        s_id=s_id,
        t_id=t_id,
        company_b_id=company_b_id,
        home_b_id=home_b_id,
        priya_email=PRIYA_EMAIL,
        hari_email=HARI_EMAIL,
        uma_email=UMA_EMAIL,
        bala_email=BALA_EMAIL,
        kiran_email=KIRAN_EMAIL,
        nisha_email=NISHA_EMAIL,
        company_b_admin_email=b.email,
        vendor_email=VENDOR_EMAIL,
        vendor_id=vendor_id,
        region_id=region_id,
        state_id=kirans_state_id,
        s_pincodes=list(s_pincodes),
        hema_pincodes=list(hema_pincodes),
        leaf_id=leaf_id,
        model_id=model_id,
        service_types=list(SERVICE_TYPES),
        ravi_phone=RAVI_PHONE,
        hema_phone=HEMA_PHONE,
        meena_phone=MEENA_PHONE,
        ravi_id=ravi_id,
        hema_id=hema_id,
        meena_id=meena_id,
    )


async def main(reset_first: bool) -> int:
    async with AsyncSessionLocal() as db:
        if reset_first:
            await reset(db)
        world = await build(db)
        await db.commit()  # the drift repairs (stamp + states) are session work
        print(f"Company A      : {world.company_a_id}")
        print(f"Home H         : {world.home_id}")
        print(f"Franchisee S   : {world.s_id}  ({S_NAME})  codes={world.s_pincodes}")
        print(f"Franchisee T   : {world.t_id}  ({T_NAME})")
        print(f"Home codes pool for Hema: {world.hema_pincodes}")
        print(f"Company B      : {world.company_b_id}   home={world.home_b_id}")
        print(f"Vendor         : {world.vendor_id}")
        print(f"Leaf / model   : {world.leaf_id} / {world.model_id}")
        print(f"Ravi (S tech)  : {world.ravi_id}  phone={world.ravi_phone}")
        print(f"Hema (H tech)  : {world.hema_id}  phone={world.hema_phone}")
        print(
            f"Meena (S employee): {world.meena_id}  phone={world.meena_phone}"
        )
        print("Done.")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true", help="Drop our logins first")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(main(args.reset)))