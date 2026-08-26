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
from app.core.schemas import ListParams
from app.core.security import hash_password
from app.db.repository import paginate
from app.features.companies.schemas import (
    CodeSuggestionOut,
    CompanyCreateRequest,
    CompanyOut,
    CompanyUpdateRequest,
)
from app.models.company import Company
from app.models.membership import Membership
from app.models.role import ADMIN
from app.models.user import User


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "company"


async def _unique_slug(session: AsyncSession, name: str) -> str:
    base = _slugify(name)
    candidate = base
    n = 2
    while await session.scalar(
        select(func.count()).select_from(Company).where(
            func.lower(Company.slug) == candidate
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

    async def taken(candidate: str) -> bool:
        return bool(
            await session.scalar(
                select(func.count()).select_from(Company).where(
                    func.lower(Company.code) == candidate.lower()
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


async def suggest_code(session: AsyncSession, name: str) -> CodeSuggestionOut:
    """The code `create_company` would derive, resolved against what exists."""
    natural = company_code.derive(name)
    assigned = await _unique_code(session, name, None)
    return CodeSuggestionOut(code=assigned, exact=assigned == natural)


async def _ensure_gst_unique(
    session: AsyncSession, gst_number: str, *, exclude_id: uuid.UUID | None = None
) -> None:
    """409 if any company (incl. soft-deleted, matching the unique index) uses this GSTIN."""
    stmt = select(func.count()).select_from(Company).where(
        func.lower(Company.gst_number) == gst_number.lower()
    )
    if exclude_id is not None:
        stmt = stmt.where(Company.id != exclude_id)
    if await session.scalar(stmt):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="GST number already registered",
        )


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
        addressLine2=company.address_line2,
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
) -> CompanyOut:
    await _ensure_gst_unique(session, body.gstNumber)
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
        address_line2=body.addressLine2,
        city=body.city,
        state=body.state,
        pincode=body.pincode,
        created_by=principal.user_id,
    )
    session.add(company)
    await session.flush()  # populate company.id

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
        admin_user = User(
            email=str(body.email),
            password_hash=hash_password(body.password),
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
    return _company_out(company, admin_email=admin_user.email, user_count=1)


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
        await _ensure_gst_unique(session, body.gstNumber, exclude_id=company.id)
        company.gst_number = body.gstNumber
    if body.pan is not None:
        company.pan = body.pan
    if body.gstCompanyStatus is not None:
        company.gst_company_status = body.gstCompanyStatus
    if body.addressLine1 is not None:
        company.address_line1 = body.addressLine1
    if body.addressLine2 is not None:
        company.address_line2 = body.addressLine2
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


async def set_status(
    session: AsyncSession, company_id: uuid.UUID, is_active: bool, principal: Principal
) -> CompanyOut:
    company = await _load_company(session, company_id)
    company.is_active = is_active
    company.updated_by = principal.user_id
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
    await session.commit()
