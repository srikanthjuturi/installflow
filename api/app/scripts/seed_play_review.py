"""Build — or top up — the company Google Play's reviewers sign in to.

    python -m app.scripts.seed_play_review                    # dev
    python -m app.scripts.seed_play_review --plan             # what it would do, no writes
    python -m app.scripts.seed_play_review --reset-passwords  # new console passwords

    $env:POSTGRES_DB='RelianceProdDB'
    python -m app.scripts.seed_play_review --production       # both, or it refuses

`RGT Play Review` (app/core/play_review.py) holds an admin, a vendor whose live
photos are NOT location-checked — the reviewer is nowhere near the customer's
door — a catalogue, one technician on PLAY_REVIEW_PHONE, and jobs in every
state a reviewer can open.

Every run finds what already exists and creates only what is missing, then tops
up the jobs, because demo jobs go stale: a pool job is offered for at most 48
hours, and a held job's slot passes. **Run it before every submission to Play.**
A held job whose slot has ended is force-closed first, so the reviewer's list
does not fill up with visits that can no longer happen.

`cleanup_db` never deletes this company. Its phone numbers are unreachable
`+911…` ones and its addresses `@seed.example.com`, like every other seed.
"""

import argparse
import asyncio
import dataclasses
import datetime
import random
import secrets
import string
import sys
import uuid

if sys.platform == "win32":  # noqa: E402
    # psycopg refuses to run async on the Proactor loop Windows defaults to.
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from fastapi import BackgroundTasks, HTTPException  # noqa: E402
from sqlalchemy import func, select  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

from app.core import play_review  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.core.deps import Principal  # noqa: E402
from app.core.errors import AppError  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.core.slots import bookable_slots  # noqa: E402
from app.features.companies import service as companies_service  # noqa: E402
from app.features.companies.schemas import CompanyCreateRequest  # noqa: E402
from app.features.jobs import service as jobs_service  # noqa: E402
from app.features.masters import service as masters_service  # noqa: E402
from app.features.masters.schemas import ModelCreateRequest, NodeCreateRequest  # noqa: E402
from app.features.technicians import service as technicians_service  # noqa: E402
from app.features.technicians.schemas import TechnicianCreateRequest  # noqa: E402
from app.features.tickets import feedback_service  # noqa: E402
from app.features.tickets import service as tickets_service  # noqa: E402
from app.features.tickets.schemas import ForceCloseRequest, TicketCreateRequest  # noqa: E402
from app.features.vendors import service as vendors_service  # noqa: E402
from app.features.vendors.schemas import VendorCreateRequest  # noqa: E402
from app.models.company import Company  # noqa: E402
from app.models.membership import Membership  # noqa: E402
from app.models.product import ProductModel, ProductNode  # noqa: E402
from app.models.role import ADMIN, ROLE_RANKS, TECHNICIAN  # noqa: E402
from app.models.technician import TechnicianProfile  # noqa: E402
from app.models.ticket import Ticket  # noqa: E402
from app.models.user import User  # noqa: E402
from app.models.vendor import Vendor  # noqa: E402
from app.models.vendor_brand import VendorBrand  # noqa: E402
from app.scripts.seed import backdate, lifecycle, tenant  # noqa: E402
from app.scripts.seed.guards import (  # noqa: E402
    SeedRefused,
    assert_target_allowed,
    assert_unreachable,
    synthetic_email,
    synthetic_phone,
)

TAG = "PLAY-REVIEW"
ADMIN_EMAIL = synthetic_email("admin.play-review")
VENDOR_EMAIL = synthetic_email("vendor.play-review")
VENDOR_NAME = "Crestline Demo Distributors"
TECHNICIAN_NAME = "Demo Technician"
ROOT_CATEGORY = "Home Appliances"
SERVICE_TYPE = "Installation + Demo"

#: A GSTIN that fits the pattern and belongs to nobody (36 is Telangana).
COMPANY_GST = "36PLAYR0001A1Z5"
VENDOR_GST = "36PLAYV0001A1Z5"

#: What a first run leaves: something in every list the reviewer can open.
FIRST_RUN: tuple[tuple[str, int], ...] = (
    ("pool_no_slot", 4),  # offered now, no time agreed yet
    ("pool_slot", 3),     # offered now, time agreed
    ("assigned", 2),      # the reviewer's own upcoming visits
    ("in_progress", 1),   # proof taken, "Complete the job" waiting
    ("closed", 4),        # history, and the payouts on the Earnings screen
)
#: What a later run adds: only what goes stale. The in-progress job is here too,
#: because `_clear_stale` force-closes it once its slot ends and nothing else
#: would ever put one back — the reviewer's In progress tab stayed empty.
TOP_UP: tuple[tuple[str, int], ...] = (
    ("pool_no_slot", 4),
    ("pool_slot", 3),
    ("assigned", 2),
    ("in_progress", 1),
)
#: How far back the history is moved.
HISTORY_DAYS = 20


@dataclasses.dataclass
class Review:
    company: Company
    admin: Principal
    vendor: Principal
    technician: TechnicianProfile
    #: (node id, model id) for every model the technician can be sent to.
    models: list[tuple[uuid.UUID, uuid.UUID]]
    pincodes: list[str]
    phone_block: int


def _args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--production",
        action="store_true",
        help="Required to write to the production database, and refused against any other.",
    )
    parser.add_argument("--plan", action="store_true", help="Print the plan and write nothing.")
    parser.add_argument(
        "--reset-passwords",
        action="store_true",
        help="Give the admin and vendor logins new passwords, and print them.",
    )
    return parser.parse_args()


def _password() -> str:
    """Sixteen characters with every class a password rule could ask for."""
    alphabet = string.ascii_letters + string.digits
    body = "".join(secrets.choice(alphabet) for _ in range(12))
    return f"{body}{secrets.choice(string.ascii_uppercase)}{secrets.choice(string.digits)}@{secrets.choice(string.ascii_lowercase)}"


def _review_phone() -> str:
    phone = play_review.review_phone()
    if phone is None:
        raise SeedRefused(
            "PLAY_REVIEW_PHONE and PLAY_REVIEW_CODE are not both set to valid values "
            "(an unreachable +911XXXXXXXXX number and a "
            f"{settings.OTP_LENGTH}-digit code) in this environment's .env."
        )
    return assert_unreachable(phone, what="the Play reviewer's technician")


def _principal(user: User, *, company_id: uuid.UUID, vendor_id: uuid.UUID | None = None) -> Principal:
    return Principal(
        user=user,
        role=user.role,
        rank=ROLE_RANKS[user.role],
        is_superadmin=False,
        company_id=company_id,
        vendor_id=vendor_id,
    )


async def _set_password(db: AsyncSession, email: str) -> str:
    user = await db.scalar(select(User).where(User.email == email))
    password = _password()
    user.password_hash = hash_password(password)
    await db.commit()
    return password


# ── the company and everything under it ──────────────────────────────────────


async def _company(db: AsyncSession, created: list[str]) -> Company:
    company = await db.scalar(
        select(Company).where(
            func.lower(Company.slug) == play_review.COMPANY_SLUG,
            Company.deleted_at.is_(None),
        )
    )
    if company is not None:
        return company
    superadmin = await tenant.principal_for(db, await tenant._superadmin(db), company_id=None)
    out = await companies_service.create_company(
        db,
        superadmin,
        CompanyCreateRequest(
            name=play_review.COMPANY_NAME,
            code=play_review.COMPANY_CODE,
            email=ADMIN_EMAIL,
            phone=synthetic_phone(555_500_001),
            adminName="Demo Admin",
            gstNumber=COMPANY_GST,
            pan=COMPANY_GST[2:12],
            gstCompanyStatus="Active",
            addressLine1="Plot 7, Demo Industrial Estate",
            city="Hyderabad",
            state="Telangana",
            pincode="500081",
        ),
    )
    if out.slug != play_review.COMPANY_SLUG:
        raise SeedRefused(
            f"The company was created with slug {out.slug!r}, not "
            f"{play_review.COMPANY_SLUG!r}, so cleanup_db would not protect it. "
            "Another company already holds that slug."
        )
    created.append("company")
    return await db.get(Company, out.id)


async def _admin(db: AsyncSession, company: Company) -> Principal:
    user = await db.scalar(
        select(User)
        .join(Membership, Membership.user_id == User.id)
        .where(
            Membership.company_id == company.id,
            Membership.deleted_at.is_(None),
            User.role == ADMIN,
            User.deleted_at.is_(None),
        )
        .order_by(User.created_at)
        .limit(1)
    )
    if user is None:
        raise SeedRefused(f"{company.name} has no admin — seeding stopped.")
    return _principal(user, company_id=company.id)


async def _vendor(db: AsyncSession, company: Company, admin: Principal, created: list[str]) -> Principal:
    vendor = await db.scalar(
        select(Vendor).where(
            Vendor.company_id == company.id,
            Vendor.name == VENDOR_NAME,
            Vendor.deleted_at.is_(None),
        )
    )
    if vendor is None:
        out = await vendors_service.create_vendor(
            db,
            admin,
            VendorCreateRequest(
                name=VENDOR_NAME,
                gstNumber=VENDOR_GST,
                pan=VENDOR_GST[2:12],
                contactPerson="Demo Vendor Contact",
                phone=synthetic_phone(555_500_002),
                address="Shed 2, Demo Distribution Park",
                city="Hyderabad",
                state="Telangana",
                pincode="500081",
                loginEmail=VENDOR_EMAIL,
                brands=["Meridian", "Sunview"],
                # OFF, unlike every other seed: a reviewer takes the live site
                # photo wherever they happen to be, and with the check on it is
                # refused and the proof flow cannot be finished.
                locationCheckEnabled=False,
            ),
        )
        vendor = await db.get(Vendor, out.id)
        created.append("vendor")
    user = await db.scalar(
        select(User)
        .join(Membership, Membership.user_id == User.id)
        .where(
            Membership.company_id == company.id,
            Membership.vendor_id == vendor.id,
            Membership.deleted_at.is_(None),
        )
        .order_by(User.created_at)
        .limit(1)
    )
    if user is None:
        raise SeedRefused(f"{VENDOR_NAME} has no login — seeding stopped.")
    return _principal(user, company_id=company.id, vendor_id=vendor.id)


async def _catalogue(
    db: AsyncSession, company: Company, admin: Principal, vendor: Principal, created: list[str]
) -> list[tuple[uuid.UUID, uuid.UUID]]:
    async def node(name: str, parent_id: uuid.UUID | None, *, leaf: bool) -> uuid.UUID:
        stmt = select(ProductNode.id).where(
            ProductNode.company_id == company.id,
            ProductNode.name == name,
            ProductNode.deleted_at.is_(None),
            ProductNode.parent_id.is_(None) if parent_id is None else ProductNode.parent_id == parent_id,
        )
        found = await db.scalar(stmt)
        if found is None:
            await masters_service.create_node(
                db, admin, NodeCreateRequest(name=name, parentId=parent_id, isLeaf=leaf)
            )
            created.append(f"category {name}")
            found = await db.scalar(stmt)
        return found

    brands = {
        name: brand_id
        for brand_id, name in (
            await db.execute(
                select(VendorBrand.id, VendorBrand.name).where(
                    VendorBrand.vendor_id == vendor.vendor_id
                )
            )
        ).all()
    }
    root_id = await node(ROOT_CATEGORY, None, leaf=False)
    models: list[tuple[uuid.UUID, uuid.UUID]] = []
    for category, entries in tenant.CATEGORIES:
        node_id = await node(category, root_id, leaf=True)
        for name, payout, price in entries:
            stmt = select(ProductModel.id).where(
                ProductModel.node_id == node_id,
                ProductModel.name == name,
                ProductModel.deleted_at.is_(None),
            )
            model_id = await db.scalar(stmt)
            if model_id is None:
                await masters_service.create_model(
                    db,
                    admin,
                    node_id,
                    ModelCreateRequest(
                        name=name,
                        vendorId=vendor.vendor_id,
                        brandId=brands[name.split()[0]],
                        serviceTypes=[SERVICE_TYPE, "Service"],
                        technicianPayoutPaise=payout,
                        vendorPricePaise=price,
                    ),
                )
                created.append(f"product {name}")
                model_id = await db.scalar(stmt)
            models.append((node_id, model_id))
    return models


async def _technician(
    db: AsyncSession,
    company: Company,
    admin: Principal,
    models: list[tuple[uuid.UUID, uuid.UUID]],
    phone: str,
    created: list[str],
) -> tuple[TechnicianProfile, list[str]]:
    existing = await db.scalar(
        select(TechnicianProfile)
        .join(Membership, Membership.id == TechnicianProfile.membership_id)
        .join(User, User.id == Membership.user_id)
        .where(
            User.phone == phone,
            User.role == TECHNICIAN,
            User.deleted_at.is_(None),
            TechnicianProfile.company_id == company.id,
        )
    )
    if existing is None:
        if await tenant._phone_taken(db, phone):
            raise SeedRefused(
                f"{phone} already belongs to a technician in another company. "
                "Pick another PLAY_REVIEW_PHONE."
            )
        region_id = await tenant._seed_region_id(db)
        out = await technicians_service.create_technician(
            db,
            admin,
            TechnicianCreateRequest(
                fullName=TECHNICIAN_NAME,
                phone=phone,
                regionId=region_id,
                # Every category, so every demo job is theirs to take.
                subcategoryIds=sorted({node_id for node_id, _ in models}, key=str),
                pincodes=await tenant._pick_pincodes(db, region_id, count=10),
                dailyJobCap=None,
            ),
        )
        existing = await db.get(TechnicianProfile, out.id)
        created.append(f"technician {TECHNICIAN_NAME}")
    workers = await lifecycle.load_workers(db, [existing])
    if not workers:
        raise SeedRefused(f"{TECHNICIAN_NAME} has no categories or pincodes.")
    return existing, workers[0].pincodes


# ── jobs ─────────────────────────────────────────────────────────────────────


async def _raise(db: AsyncSession, ctx: Review, *, index: int, with_slot: bool, rng: random.Random) -> Ticket:
    node_id, model_id = rng.choice(ctx.models)
    created = await tickets_service.create_ticket(
        db,
        ctx.vendor,
        TicketCreateRequest(
            subcategoryId=node_id,
            modelId=model_id,
            serviceType=SERVICE_TYPE,
            description=None,
            serialNumber=f"DM{index:06d}{uuid.uuid4().hex[:4].upper()}",
            customerName=lifecycle.CUSTOMER_NAMES[index % len(lifecycle.CUSTOMER_NAMES)],
            customerPhone=assert_unreachable(
                synthetic_phone(ctx.phone_block + 50_000 + index % 50_000),
                what=f"customer for demo ticket {index}",
            ),
            address=f"Flat {index % 400 + 1}, Demo Residency, Phase {index % 4 + 1}",
            city="Hyderabad",
            state="Telangana",
            pincode=rng.choice(ctx.pincodes),
            expectedDate=datetime.date.today() + datetime.timedelta(days=1),
            # The longest service level: a job with no time agreed stays in the
            # pool until its deadline, so this is what keeps it there longest.
            serviceLevelHours=48,
        ),
    )
    row = await db.get(Ticket, created.id)
    if with_slot:
        # One of the LATEST windows the server offers, not the earliest. A pool
        # job is escalated — and leaves the pool — a few hours before its slot,
        # and a review can start days after this runs; the first run took this
        # evening's window and lost two pool jobs to escalation within minutes.
        windows = await bookable_slots(db, row)
        if windows:
            start, _end = rng.choice(windows[-4:])
            await tickets_service.confirm_slot(db, row.slot_token, start)
            await db.refresh(row)
    return row


async def _one(db: AsyncSession, ctx: Review, intent: str, *, index: int, rng: random.Random) -> Ticket:
    company_id = ctx.company.id
    profile = ctx.technician
    row = await _raise(db, ctx, index=index, with_slot=intent != "pool_no_slot", rng=rng)
    if intent in ("pool_no_slot", "pool_slot"):
        return row

    await jobs_service.accept(
        db, row.id, company_id=company_id, profile=profile, background=BackgroundTasks()
    )
    await db.refresh(row)
    if intent == "assigned":
        return row

    await jobs_service.submit_proof(
        db,
        row.id,
        company_id=company_id,
        profile=profile,
        artifacts=lifecycle._artifacts(company_id, row),
        observed_serial=row.serial_number,
        observed_serial_source="scanned",
    )
    await db.refresh(row)
    if intent == "in_progress":
        return row

    await jobs_service.complete(db, row.id, company_id=company_id, profile=profile)
    await db.refresh(row)
    await feedback_service.record_feedback(
        db,
        row.feedback_token,
        confirmed=True,
        rating=rng.choice((4, 5, 5)),
        comment=rng.choice(("Neat installation, happy with the work.", "Good service.")),
    )
    await db.refresh(row)
    return row


async def _clear_stale(db: AsyncSession, ctx: Review) -> int:
    """Force-close the reviewer's held jobs whose visit window has ended.

    Force-closing is the product's own way to settle a job nobody can finish,
    and it pays nothing here — the visit never happened.
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    stale = list(
        await db.scalars(
            select(Ticket.id).where(
                Ticket.company_id == ctx.company.id,
                Ticket.technician_id == ctx.technician.id,
                Ticket.status.in_(("Assigned", "In Progress")),
                Ticket.slot_end.is_not(None),
                Ticket.slot_end < now,
            )
        )
    )
    for ticket_id in stale:
        await tickets_service.force_close_ticket(
            db,
            ctx.admin,
            ticket_id,
            ForceCloseRequest(
                reason="Demo job cleared before a new review",
                notes="The visit window ended before anybody opened this demo job.",
                attachments=[
                    {"blobName": f"attachment/{ctx.company.id}/seed/{ticket_id}/note.png"}
                ],
                technicianPayoutPaise=0,
            ),
        )
    return len(stale)


async def _count(db: AsyncSession, ctx: Review, *statuses: str) -> int:
    return await db.scalar(
        select(func.count(Ticket.id)).where(
            Ticket.company_id == ctx.company.id,
            Ticket.status.in_(statuses),
        )
    )


# ── main ─────────────────────────────────────────────────────────────────────


async def main() -> int:
    # A Windows console is cp1252: one dash it cannot encode, printed after the
    # writes, would crash the run and lose the passwords it had just set.
    sys.stdout.reconfigure(errors="replace")
    args = _args()
    database = assert_target_allowed(production=args.production)
    phone = _review_phone()

    print(f"\nPlay review company in {database}")
    print(f"  company     {play_review.COMPANY_NAME} (code {play_review.COMPANY_CODE}, "
          f"slug {play_review.COMPANY_SLUG})")
    print(f"  logins      admin {ADMIN_EMAIL}, vendor {VENDOR_EMAIL}")
    print(f"  reviewer    {TECHNICIAN_NAME}, {phone}")
    print(f"  vendor      {VENDOR_NAME} - live photo location check OFF")
    print("  first run   " + ", ".join(f"{n} {i}" for i, n in FIRST_RUN))
    print("  later runs  " + ", ".join(f"{n} {i}" for i, n in TOP_UP)
          + ", after force-closing held jobs whose slot has ended")
    if args.plan:
        print("\n--plan: nothing was written.\n")
        return 0
    if args.production:
        typed = input(f"\n  Type the database name to continue [{database}]: ").strip()
        if typed != database:
            raise SeedRefused("Not confirmed — nothing was written.")

    rng = random.Random()
    created: list[str] = []
    async with AsyncSessionLocal() as db:
        company = await _company(db, created)
        admin = await _admin(db, company)
        vendor = await _vendor(db, company, admin, created)
        models = await _catalogue(db, company, admin, vendor, created)
        technician, pincodes = await _technician(db, company, admin, models, phone, created)
        ctx = Review(
            company=company,
            admin=admin,
            vendor=vendor,
            technician=technician,
            models=models,
            pincodes=pincodes,
            phone_block=tenant.phone_block(TAG),
        )
        print("\n  created: " + (", ".join(created) if created else "nothing - it all exists"))

        # Printed the moment they are set, so a job refused further down cannot
        # lose them.
        emails = [
            email
            for email, fresh in ((ADMIN_EMAIL, "company"), (VENDOR_EMAIL, "vendor"))
            if fresh in created or args.reset_passwords
        ]
        if emails:
            print("\n  Console logins - shown once, save them now:")
            for email in emails:
                print(f"    {email}   {await _set_password(db, email)}")
            print()

        cleared = await _clear_stale(db, ctx)
        if cleared:
            print(f"  force-closed {cleared} held job(s) whose slot had ended")

        has_history = await _count(db, ctx, "Closed", "Force-Closed")
        mix = TOP_UP if has_history else FIRST_RUN
        start = await db.scalar(
            select(func.count(Ticket.id)).where(Ticket.company_id == company.id)
        )
        written: list[Ticket] = []
        for intent, count in mix:
            for _ in range(count):
                start += 1
                try:
                    row = await _one(db, ctx, intent, index=start, rng=rng)
                except (AppError, HTTPException) as exc:
                    detail = getattr(exc, "detail", exc)
                    raise SeedRefused(
                        f"A {intent} demo job was refused: {detail}. Jobs written so far "
                        "are kept; fix the cause and run this again."
                    ) from exc
                written.append(row)
                print(f"    {intent:14} {row.code}  {row.status}")

        # Backdating is last: any later write would re-stamp `updated_at`.
        for row in written:
            if row.status == "Closed":
                await backdate.shift_ticket(
                    db,
                    row.id,
                    delta=datetime.timedelta(
                        days=rng.randint(2, HISTORY_DAYS), hours=rng.randint(0, 8)
                    ),
                )
        await db.commit()

        pool = await _count(db, ctx, "New", "Slot Pending")
        held = await db.scalar(
            select(func.count(Ticket.id)).where(
                Ticket.company_id == company.id,
                Ticket.technician_id == technician.id,
                Ticket.status.in_(("Assigned", "In Progress")),
            )
        )

    print(f"\n  {len(written)} demo job(s) added. The pool holds {pool}; "
          f"the reviewer holds {held}.")
    print(f"  company id: {company.id}")
    print("\n  Google Play Console > App content > App access:")
    print(f"    mobile number  {phone[3:]}   (the app adds +91)")
    print(f"    code           {settings.PLAY_REVIEW_CODE.strip()}")
    print("\n  Run this again before every submission; pool jobs expire after 48 hours.\n")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except SeedRefused as refusal:
        print(f"\n  REFUSED: {refusal}\n")
        sys.exit(2)
