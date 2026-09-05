"""Company (tenant) management — superadmin only.

Creating a company is atomic: the company row, the admin identity (reused if the
email already exists as an admin, else created with the given password), and the
admin membership are all committed together.
"""

import re
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import company_code
from app.core.deps import Principal
from app.core.gst import assert_gstin_free_for_company
from app.core.rules import load_rules
from app.core.schemas import EmailStatus, ListParams
from app.core.security import generate_temporary_password, hash_password
from app.core.sessions import revoke_refresh_tokens
from app.db.repository import paginate
from app.emails import send_temporary_password
from app.features.companies.schemas import (
    CompanyCreateRequest,
    CompanyCreatedOut,
    CompanyOut,
    CompanyUpdateRequest,
)
from app.models.company import Company
from app.models.membership import Membership
from app.models.role import ADMIN, ROLE_LABELS
from app.models.user import User


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "company"


async def _unique_slug(session: AsyncSession, name: str) -> str:
    """The first free slug, ignoring soft-deleted companies.

    `deleted_at IS NULL` matches `uq_companies_slug_lower` (partial since
    `4c8f1b7d2e93`). Without it a deleted `acme` pushed every later Acme on to
    `acme-2` for good — no error, just a worse slug nobody could account for.
    """
    base = _slugify(name)
    candidate = base
    n = 2
    while await session.scalar(
        select(func.count()).select_from(Company).where(
            Company.deleted_at.is_(None),
            func.lower(Company.slug) == candidate,
        )
    ):
        candidate = f"{base}-{n}"
        n += 1
    return candidate


async def _unique_code(
    session: AsyncSession, name: str, requested: str | None
) -> str:
    """The company's permanent code — the one the superadmin confirmed, or ours.

    A collision is resolved by appending a digit rather than refusing, but ONLY
    when the code was derived. A code somebody actually typed is answered with a
    409 instead: silently storing ACE2 for a superadmin who asked for ACE means
    every ticket that company ever prints carries a name they did not choose.
    """
    typed = bool(company_code.normalise(requested or ""))
    base = company_code.normalise(requested) if typed else company_code.derive(name)

    if typed:
        problem = company_code.validate(base)
        if problem:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=problem
            )

    # `deleted_at IS NULL` matches `uq_companies_code_lower`, which
    # `b1c4e77a9d20` created partial precisely so a retired company does not keep
    # its code reserved forever. A deleted RGT therefore neither refuses a typed
    # RGT nor pushes a derived one on to RGT2.
    async def taken(candidate: str) -> bool:
        return bool(
            await session.scalar(
                select(func.count()).select_from(Company).where(
                    Company.deleted_at.is_(None),
                    func.lower(Company.code) == candidate.lower(),
                )
            )
        )

    if typed:
        if await taken(base):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Company code {base} is already in use",
            )
        return base

    candidate, n = base, 2
    while await taken(candidate):
        suffix = str(n)
        candidate = f"{base[: company_code.MAX_LEN - len(suffix)]}{suffix}"
        n += 1
    return candidate


def _company_out(
    company: Company, *, admin_email: str | None = None, user_count: int | None = None
) -> CompanyOut:
    return CompanyOut(
        id=company.id,
        name=company.name,
        slug=company.slug,
        code=company.code,
        email=company.email,
        phone=company.phone,
        isActive=company.is_active,
        gstNumber=company.gst_number,
        pan=company.pan,
        gstCompanyStatus=company.gst_company_status,
        addressLine1=company.address_line1,
        city=company.city,
        state=company.state,
        pincode=company.pincode,
        adminEmail=admin_email,
        userCount=user_count,
        createdAt=company.created_at,
    )


async def _load_company(session: AsyncSession, company_id: uuid.UUID) -> Company:
    company = await session.scalar(
        select(Company).where(
            Company.id == company_id, Company.deleted_at.is_(None)
        )
    )
    if company is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Company not found"
        )
    return company


async def _admin_email(session: AsyncSession, company_id: uuid.UUID) -> str | None:
    return await session.scalar(
        select(User.email)
        .join(Membership, Membership.user_id == User.id)
        .where(
            Membership.company_id == company_id,
            Membership.deleted_at.is_(None),
            User.role == ADMIN,
        )
        .order_by(Membership.created_at)
        .limit(1)
    )


async def _user_count(session: AsyncSession, company_id: uuid.UUID) -> int:
    return int(
        await session.scalar(
            select(func.count()).select_from(Membership).where(
                Membership.company_id == company_id,
                Membership.deleted_at.is_(None),
            )
        )
        or 0
    )


async def create_company(
    session: AsyncSession, principal: Principal, body: CompanyCreateRequest
) -> CompanyCreatedOut:
    # No `exclude_id`, which also means the vendor half of the check is skipped:
    # a company being created has no vendors, so it could not return a row.
    await assert_gstin_free_for_company(session, body.gstNumber)
    slug = await _unique_slug(session, body.name)
    code = await _unique_code(session, body.name, body.code)
    company = Company(
        name=body.name,
        slug=slug,
        code=code,
        email=str(body.email),
        phone=body.phone,
        is_active=True,
        gst_number=body.gstNumber,
        pan=body.pan,
        gst_company_status=body.gstCompanyStatus,
        address_line1=body.addressLine1,
        city=body.city,
        state=body.state,
        pincode=body.pincode,
        created_by=principal.user_id,
    )
    session.add(company)
    await session.flush()  # populate company.id

    # A tenant with no rules row is a tenant the sweeps cannot see — they INNER
    # JOIN it to find each company's own escalation window. Written here, in the
    # same transaction as the company, rather than left to the first person who
    # opens Rules configuration.
    await load_rules(session, company.id)

    # Stays None on the reuse branch: that admin already has a password, and
    # `users` is global, so minting a new one would sign them out of every other
    # company they administer.
    temporary_password: str | None = None

    existing = await session.scalar(
        select(User).where(func.lower(User.email) == str(body.email).lower())
    )
    if existing is not None:
        if existing.deleted_at is not None or existing.role != ADMIN:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Email already belongs to another user",
            )
        admin_user = existing  # reuse identity → admin of multiple companies
    else:
        temporary_password = generate_temporary_password()
        admin_user = User(
            email=str(body.email),
            password_hash=hash_password(temporary_password),
            full_name=body.adminName,
            role=ADMIN,
            is_active=True,
            created_by=principal.user_id,
        )
        session.add(admin_user)
        await session.flush()

    session.add(
        Membership(
            user_id=admin_user.id,
            company_id=company.id,
            is_active=True,
            created_by=principal.user_id,
        )
    )
    await session.commit()
    await session.refresh(company)
    base = _company_out(company, admin_email=admin_user.email, user_count=1)

    # After the commit — see `users.service.create_user` for the ordering. The
    # company is named as itself here, not as the superadmin's tenant: this
    # admin has never heard of us under any other name.
    if temporary_password is None:
        outcome: dict[str, object] = {
            "emailStatus": "skipped",
            "emailError": None,
            "temporaryPassword": None,
        }
    else:
        result = await send_temporary_password(
            to=str(admin_user.email),
            full_name=admin_user.full_name,
            company_name=company.name,
            role_label=ROLE_LABELS.get(ADMIN, ADMIN),
            temporary_password=temporary_password,
        )
        status_value: EmailStatus = "sent" if result.ok else "failed"
        outcome = {
            "emailStatus": status_value,
            "emailError": None if result.ok else result.error,
            "temporaryPassword": None if result.ok else temporary_password,
        }
    return CompanyCreatedOut(**base.model_dump(), **outcome)


async def list_companies(
    session: AsyncSession, params: ListParams
) -> tuple[list[CompanyOut], int]:
    stmt = select(Company).where(Company.deleted_at.is_(None))
    if params.search:
        term = f"%{params.search.lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(Company.name).like(term),
                func.lower(Company.email).like(term),
                func.lower(Company.slug).like(term),
            )
        )
    sort_col = {
        "name": Company.name,
        "email": Company.email,
        "isActive": Company.is_active,
        "createdAt": Company.created_at,
    }.get(params.sortBy or "createdAt", Company.created_at)
    stmt = stmt.order_by(sort_col.desc() if params.sortDir == "desc" else sort_col.asc())

    rows, total = await paginate(session, stmt, page=params.page, limit=params.limit)
    return [_company_out(c) for c in rows], total


async def get_company(session: AsyncSession, company_id: uuid.UUID) -> CompanyOut:
    company = await _load_company(session, company_id)
    return _company_out(
        company,
        admin_email=await _admin_email(session, company_id),
        user_count=await _user_count(session, company_id),
    )


async def update_company(
    session: AsyncSession, company_id: uuid.UUID, body: CompanyUpdateRequest,
    principal: Principal,
) -> CompanyOut:
    company = await _load_company(session, company_id)
    if body.name is not None:
        company.name = body.name
    if body.email is not None:
        company.email = str(body.email)
    if body.phone is not None:
        company.phone = body.phone
    if body.gstNumber is not None and body.gstNumber.lower() != company.gst_number.lower():
        # Both edges of the rule: no other company may hold it, and neither may
        # one of THIS company's own vendors — a company and its vendor are
        # different legal entities by definition. `exclude_id` is the company
        # being edited on both counts; `app.core.gst` owns the pair, so the
        # GSTIN box refuses the same number in the same words before the save.
        await assert_gstin_free_for_company(
            session, body.gstNumber, exclude_id=company.id
        )
        company.gst_number = body.gstNumber
    if body.pan is not None:
        company.pan = body.pan
    if body.gstCompanyStatus is not None:
        company.gst_company_status = body.gstCompanyStatus
    if body.addressLine1 is not None:
        company.address_line1 = body.addressLine1
    if body.city is not None:
        company.city = body.city
    if body.state is not None:
        company.state = body.state
    if body.pincode is not None:
        company.pincode = body.pincode
    company.updated_by = principal.user_id
    await session.commit()
    await session.refresh(company)
    return _company_out(
        company,
        admin_email=await _admin_email(session, company_id),
        user_count=await _user_count(session, company_id),
    )


async def _end_sessions(session: AsyncSession, company_id: uuid.UUID) -> None:
    """Sign out everyone who belongs to this company.

    `get_current_principal` refuses a shut company on the next request, so this
    is not what enforces the closure — it closes the SEVEN-DAY half. A refresh
    token outlives the 30-minute access token by a week, and both clients renew
    on a 401 without showing anybody a login screen; revoking here means the
    renewal fails now rather than whenever the last token happens to lapse.

    Refresh tokens are not company-scoped (`refresh_tokens` carries a user, no
    company), so someone who administers two companies is signed out of both.
    One re-login, and they come back with only the companies still open —
    `delete_vendor` accepts exactly the same trade for the same reason.

    Does not commit: the caller owns the transaction, so the revocation lands
    with the suspension that caused it or not at all.
    """
    user_ids = (
        await session.scalars(
            select(Membership.user_id).where(
                Membership.company_id == company_id,
                Membership.deleted_at.is_(None),
            )
        )
    ).all()
    for user_id in set(user_ids):
        await revoke_refresh_tokens(session, user_id)


async def set_status(
    session: AsyncSession, company_id: uuid.UUID, is_active: bool, principal: Principal
) -> CompanyOut:
    company = await _load_company(session, company_id)
    company.is_active = is_active
    company.updated_by = principal.user_id
    # Only on the way DOWN. Activating is constructive, and there is no session
    # left to end — suspending already took them.
    if not is_active:
        await _end_sessions(session, company_id)
    await session.commit()
    await session.refresh(company)
    return _company_out(company)


async def delete_company(
    session: AsyncSession, company_id: uuid.UUID, principal: Principal
) -> None:
    company = await _load_company(session, company_id)
    company.deleted_at = datetime.now(timezone.utc)
    company.is_active = False
    company.updated_by = principal.user_id
    # The memberships are deliberately left alone — the console promises
    # "existing user identities are kept", and they are what a restore would need
    # to put the company back. Nothing depends on them any more: every door now
    # checks the COMPANY.
    await _end_sessions(session, company_id)
    await session.commit()
