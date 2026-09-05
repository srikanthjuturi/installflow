"""Vendor service — the brand master, company-scoped.

Every read and write filters on `principal.company_id` and `deleted_at IS NULL`,
fetch-by-id included, so guessing another company's vendor id returns 404 and
not a 403 that would confirm the row exists.

No territory scoping: a brand list is company-wide, not regional. The seniority
restriction lives in the router, not here.

Deleting is soft and refuses to orphan — a vendor that still brands product
models is a 409 naming the count, the same shape masters uses for a subcategory
somebody is certified for.
"""

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import Select, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Principal
from app.core.gst import assert_gstin_free_for_vendor
from app.core.intake import (
    CHANNEL_DESCRIPTION,
    INTAKE_CHANNELS,
    UNAVAILABLE_REASON,
    is_available,
)
from app.core.schemas import EmailStatus, ListParams
from app.db.repository import paginate
from app.emails import send_temporary_password
from app.features.vendors.schemas import (
    AddressSearchRequest,
    IntakeChannelOut,
    VendorCreateRequest,
    VendorCreatedOut,
    VendorOptionOut,
    VendorOut,
    VendorUpdateRequest,
)
from app.core.security import generate_temporary_password, hash_password
from app.core.sessions import revoke_refresh_tokens
from app.models.company import Company
from app.models.membership import Membership
from app.models.product import ProductModel
from app.models.role import ROLE_LABELS, VENDOR, VENDOR_ROLES
from app.models.ticket import Ticket
from app.models.user import User
from app.models.vendor import Vendor
from app.models.vendor_address_search import VendorAddressSearch

SORTABLE = {
    "name": Vendor.name,
    "city": Vendor.city,
    "contactPerson": Vendor.contact_person,
    "createdAt": Vendor.created_at,
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor not found")


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


# ── loaders ───────────────────────────────────────────────────────────────────


async def _load(
    db: AsyncSession, company_id: uuid.UUID, vendor_id: uuid.UUID
) -> Vendor:
    row = await db.scalar(
        select(Vendor).where(
            Vendor.id == vendor_id,
            Vendor.company_id == company_id,
            Vendor.deleted_at.is_(None),
        )
    )
    if row is None:
        raise _not_found()
    return row


# ── uniqueness pre-checks ─────────────────────────────────────────────────────


async def _assert_name_free(
    db: AsyncSession,
    company_id: uuid.UUID,
    name: str,
    *,
    exclude_id: uuid.UUID | None = None,
) -> None:
    stmt = select(Vendor.id).where(
        Vendor.company_id == company_id,
        Vendor.deleted_at.is_(None),
        func.lower(Vendor.name) == name.lower(),
    )
    if exclude_id is not None:
        stmt = stmt.where(Vendor.id != exclude_id)
    if await db.scalar(stmt) is not None:
        raise _conflict(f"A vendor called {name} already exists")


async def _resolve_login_identity(
    db: AsyncSession, company_id: uuid.UUID, email: str
) -> User | None:
    """The user this email may become a vendor login for, or None if it is new.

    Three outcomes, and the two refusals must not read alike — an operator who
    hits the first should stop and use a different address, while the second is
    just a duplicate they can see on screen.

    * **Held by staff or a technician** → refused, permanently. `users.role` is
      immutable and no endpoint changes it, so this address can never become a
      vendor login. Say so, rather than leaving them to retry.
    * **Already a vendor login in THIS company** → refused as a duplicate. One
      membership per (user, company), so it could not be two vendors here.
    * **Already a vendor login in ANOTHER company** → reused. One person, one
      identity, a membership per company — which is exactly why `vendor_id`
      lives on the membership and not on the user.
    """
    existing = await db.scalar(
        select(User).where(
            func.lower(User.email) == email.lower(), User.deleted_at.is_(None)
        )
    )
    if existing is None:
        return None

    if existing.role not in VENDOR_ROLES:
        raise _conflict(
            f"{email} already signs in as {ROLE_LABELS.get(existing.role, existing.role)}. "
            "An account cannot be both — use a different address for the vendor."
        )

    clash = await db.scalar(
        select(Membership.id).where(
            Membership.user_id == existing.id,
            Membership.company_id == company_id,
            Membership.deleted_at.is_(None),
        )
    )
    if clash is not None:
        raise _conflict(f"{email} is already the login for another vendor here")
    return existing


# ── hydration ─────────────────────────────────────────────────────────────────


async def _model_counts(
    db: AsyncSession, vendor_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    """Live product models per vendor — one grouped query, never N+1."""
    if not vendor_ids:
        return {}
    rows = await db.execute(
        select(ProductModel.vendor_id, func.count(ProductModel.id))
        .where(
            ProductModel.vendor_id.in_(vendor_ids),
            ProductModel.deleted_at.is_(None),
        )
        .group_by(ProductModel.vendor_id)
    )
    return {vendor_id: count for vendor_id, count in rows}


async def _ticket_counts(
    db: AsyncSession, company_id: uuid.UUID, vendor_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    """Live tickets per vendor — one grouped query, never N+1.

    This read `0` in code until vendors could raise their own, with a comment
    saying it would become a real count the day one could. That day is now.
    """
    if not vendor_ids:
        return {}
    rows = await db.execute(
        select(Ticket.vendor_id, func.count(Ticket.id))
        .where(
            Ticket.company_id == company_id,
            Ticket.vendor_id.in_(vendor_ids),
            Ticket.deleted_at.is_(None),
        )
        .group_by(Ticket.vendor_id)
    )
    return {vendor_id: count for vendor_id, count in rows}


async def _login_emails(
    db: AsyncSession, company_id: uuid.UUID, vendor_ids: list[uuid.UUID]
) -> dict[uuid.UUID, str]:
    """The address each vendor signs in with, from its `vendor` membership.

    Sub-users are excluded by role: a vendor has exactly one account that IS the
    vendor, and any number that merely belong to it.
    """
    if not vendor_ids:
        return {}
    rows = await db.execute(
        select(Membership.vendor_id, User.email)
        .join(User, User.id == Membership.user_id)
        .where(
            Membership.company_id == company_id,
            Membership.vendor_id.in_(vendor_ids),
            Membership.deleted_at.is_(None),
            User.role == VENDOR,
            User.deleted_at.is_(None),
        )
    )
    return {vendor_id: email for vendor_id, email in rows if email}


async def _address_search_counts(
    db: AsyncSession, company_id: uuid.UUID, vendor_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    """Address searches per vendor — one grouped query, never N+1.

    LIFETIME. No date filter, and no `deleted_at` filter either: the table has
    no soft delete, because a record of what was spent is never edited.

    Read live rather than kept in a column on `vendors`, per hard rule 8 —
    `technician_profiles.jobs_completed` was a `NOT NULL DEFAULT 0` counter
    nothing measured, and every profile asserted a zero it had never taken.
    """
    if not vendor_ids:
        return {}
    rows = await db.execute(
        select(
            VendorAddressSearch.vendor_id, func.count(VendorAddressSearch.id)
        )
        .where(
            VendorAddressSearch.company_id == company_id,
            VendorAddressSearch.vendor_id.in_(vendor_ids),
        )
        .group_by(VendorAddressSearch.vendor_id)
    )
    return {vendor_id: count for vendor_id, count in rows}


def _to_out(
    row: Vendor,
    model_count: int,
    ticket_count: int = 0,
    login_email: str | None = None,
    address_search_count: int = 0,
) -> VendorOut:
    return VendorOut(
        id=row.id,
        name=row.name,
        gstNumber=row.gst_number,
        pan=row.pan,
        gstCompanyStatus=row.gst_company_status,
        cin=row.cin,
        contactPerson=row.contact_person,
        phone=row.phone,
        address=row.address,
        city=row.city,
        state=row.state,
        pincode=row.pincode,
        intakeChannels=list(row.intake_channels or []),
        isActive=row.is_active,
        addressSearchEnabled=row.address_search_enabled,
        locationCheckEnabled=row.location_check_enabled,
        addressSearchCount=address_search_count,
        modelCount=model_count,
        ticketCount=ticket_count,
        loginEmail=login_email,
        createdAt=row.created_at,
    )


async def _hydrate(
    db: AsyncSession, company_id: uuid.UUID, rows: list[Vendor]
) -> list[VendorOut]:
    """Resolve the four derived figures for a page — four queries, not 4N."""
    ids = [r.id for r in rows]
    models = await _model_counts(db, ids)
    tickets = await _ticket_counts(db, company_id, ids)
    logins = await _login_emails(db, company_id, ids)
    searches = await _address_search_counts(db, company_id, ids)
    return [
        _to_out(
            r,
            models.get(r.id, 0),
            tickets.get(r.id, 0),
            logins.get(r.id),
            searches.get(r.id, 0),
        )
        for r in rows
    ]


async def _one(db: AsyncSession, company_id: uuid.UUID, row: Vendor) -> VendorOut:
    return (await _hydrate(db, company_id, [row]))[0]


# ── read ──────────────────────────────────────────────────────────────────────


def _apply_search(stmt: Select, search: str | None) -> Select:
    if not search:
        return stmt
    term = f"%{search.strip().lower()}%"
    return stmt.where(
        or_(
            func.lower(Vendor.name).like(term),
            func.lower(Vendor.gst_number).like(term),
            func.lower(Vendor.contact_person).like(term),
            func.lower(Vendor.phone).like(term),
            func.lower(Vendor.city).like(term),
        )
    )


async def list_vendors(
    db: AsyncSession,
    principal: Principal,
    params: ListParams,
    *,
    status_filter: str | None = None,
    channel: str | None = None,
) -> tuple[list[VendorOut], int]:
    stmt = select(Vendor).where(
        Vendor.company_id == principal.company_id,
        Vendor.deleted_at.is_(None),
    )
    stmt = _apply_search(stmt, params.search)

    # Both filters arrive from a shareable query string and are matched
    # case-insensitively, so an older bookmark cannot 422 the whole list.
    status_key = (status_filter or "").strip().lower()
    if status_key == "active":
        stmt = stmt.where(Vendor.is_active.is_(True))
    elif status_key == "paused":
        stmt = stmt.where(Vendor.is_active.is_(False))

    if channel:
        # Canonicalised to the stored spelling first — JSONB containment is
        # exact, so "excel" would silently match nothing at all.
        wanted = next(
            (c for c in INTAKE_CHANNELS if c.lower() == channel.strip().lower()),
            None,
        )
        if wanted is None:
            return [], 0
        # Containment, so the GIN index does the work rather than a scan that
        # unpacks every row's array.
        stmt = stmt.where(Vendor.intake_channels.contains([wanted]))

    column = SORTABLE.get(params.sortBy or "name", Vendor.name)
    stmt = stmt.order_by(column.desc() if params.sortDir == "desc" else column.asc())

    rows, total = await paginate(db, stmt, page=params.page, limit=params.limit)
    return await _hydrate(db, principal.company_id, rows), total


async def get_vendor(
    db: AsyncSession, principal: Principal, vendor_id: uuid.UUID
) -> VendorOut:
    return await _one(
        db, principal.company_id, await _load(db, principal.company_id, vendor_id)
    )


def list_channels() -> list[IntakeChannelOut]:
    """The intake-channel catalogue, in requirement-document order.

    Not a database read — the three channels are code on every surface. This
    endpoint exists so the console renders one "coming soon" reason and cannot
    offer a channel the schema layer would refuse, not so the set can change at
    runtime. Same reasoning as `GET /masters/icons`.
    """
    return [
        IntakeChannelOut(
            value=channel,
            description=CHANNEL_DESCRIPTION[channel],
            available=is_available(channel),
            unavailableReason=(
                None if is_available(channel) else UNAVAILABLE_REASON.get(channel)
            ),
        )
        for channel in INTAKE_CHANNELS
    ]


async def list_options(
    db: AsyncSession, principal: Principal
) -> list[VendorOptionOut]:
    """Every selectable brand, unpaginated — the model form needs them all.

    Paused and removed vendors are excluded: this drives a picker for NEW
    attributions, and a paused vendor is precisely one you should stop
    attributing to. Models already branded with it keep their brand.

    A VENDOR caller gets only itself. This endpoint is gated on `masters.view`
    rather than `vendors.view` — deliberately, so the product-model form is not
    dead-ended — and a vendor holds that key for its intake form. Without this
    narrowing that key would hand it the company's entire competitor list.
    """
    stmt = select(Vendor).where(
        Vendor.company_id == principal.company_id,
        Vendor.deleted_at.is_(None),
        Vendor.is_active.is_(True),
    )
    if principal.is_vendor:
        stmt = stmt.where(Vendor.id == principal.vendor_id)
    rows = await db.scalars(stmt.order_by(Vendor.name))
    return [VendorOptionOut(id=r.id, name=r.name) for r in rows]


# ── write ─────────────────────────────────────────────────────────────────────


async def create_vendor(
    db: AsyncSession, principal: Principal, body: VendorCreateRequest
) -> VendorCreatedOut:
    """The vendor record and the account that signs in as it, in ONE transaction.

    Both or neither. A vendor with no login is a brand nobody can raise a ticket
    against, and a login with no vendor is an account that authenticates and
    then has nothing to act for — so a half-written pair is worse than a refusal.

    Every uniqueness check runs BEFORE the first insert, so the caller gets one
    clear 409 naming what clashed rather than a rollback out of the database.
    """
    company_id = principal.company_id
    name = body.name.strip()
    await _assert_name_free(db, company_id, name)
    # Another vendor here, or the company's own number — a vendor is an outside
    # party, so it cannot be registered under the GSTIN of the company it
    # supplies. `app.core.gst` owns both, in that order, and the vendor form's
    # GSTIN box refuses the same number in the same words before the save.
    await assert_gstin_free_for_vendor(db, company_id, body.gstNumber)
    identity = await _resolve_login_identity(db, company_id, str(body.loginEmail))

    contact = body.contactPerson.strip()
    row = Vendor(
        company_id=company_id,
        name=name,
        gst_number=body.gstNumber,
        pan=body.pan,
        gst_company_status=body.gstCompanyStatus,
        cin=body.cin,
        contact_person=contact,
        phone=body.phone,
        address=body.address,
        city=body.city,
        state=body.state,
        pincode=body.pincode,
        intake_channels=list(body.intakeChannels),
        is_active=body.isActive,
        address_search_enabled=body.addressSearchEnabled,
        location_check_enabled=body.locationCheckEnabled,
        created_by=principal.user_id,
    )
    db.add(row)
    # autoflush is OFF (hard rule 9) and the membership needs the vendor's id.
    await db.flush()

    # Stays None when an existing identity is reused — that account keeps the
    # password it already signs in with everywhere else.
    temporary_password: str | None = None
    if identity is None:
        # The account describes the same human as the record: the contact
        # person's name, the vendor's phone. Two rows that would otherwise drift
        # apart the first time one of them is corrected.
        temporary_password = generate_temporary_password()
        identity = User(
            email=str(body.loginEmail),
            password_hash=hash_password(temporary_password),
            full_name=contact,
            phone=body.phone,
            role=VENDOR,
            is_active=True,
            created_by=principal.user_id,
        )
        db.add(identity)
        await db.flush()

    db.add(
        Membership(
            user_id=identity.id,
            company_id=company_id,
            vendor_id=row.id,
            is_active=True,
            created_by=principal.user_id,
        )
    )
    await db.commit()
    await db.refresh(row)
    base = await _one(db, company_id, row)
    # After the commit — see `users.service.create_user` for the ordering.
    outcome = await _mail_password(
        db,
        company_id=company_id,
        user=identity,
        temporary_password=temporary_password,
    )
    return VendorCreatedOut(**base.model_dump(), **outcome)


async def _mail_password(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    user: User,
    temporary_password: str | None,
) -> dict[str, object]:
    """Send the temporary password and report what happened. Never raises."""
    if temporary_password is None:
        return {"emailStatus": "skipped", "emailError": None, "temporaryPassword": None}

    company_name = await db.scalar(select(Company.name).where(Company.id == company_id))
    result = await send_temporary_password(
        to=str(user.email),
        full_name=user.full_name,
        company_name=company_name or "Reliance GreenTech",
        role_label=ROLE_LABELS.get(user.role, user.role),
        temporary_password=temporary_password,
    )
    status_value: EmailStatus = "sent" if result.ok else "failed"
    return {
        "emailStatus": status_value,
        "emailError": None if result.ok else result.error,
        "temporaryPassword": None if result.ok else temporary_password,
    }


async def reissue_login_password(
    db: AsyncSession, principal: Principal, vendor_id: uuid.UUID
) -> VendorCreatedOut:
    """Email this vendor a fresh temporary password and end its sessions.

    Replaces the `password` field that used to ride on `PUT /vendors/{id}`: the
    password is the server's to choose now, so there is nothing to send.
    """
    row = await _load(db, principal.company_id, vendor_id)
    account, temporary_password = await _reset_login_password(db, principal, row)
    await db.commit()
    await db.refresh(account)

    base = await _one(db, principal.company_id, row)
    outcome = await _mail_password(
        db,
        company_id=principal.company_id,
        user=account,
        temporary_password=temporary_password,
    )
    return VendorCreatedOut(**base.model_dump(), **outcome)


async def _reset_login_password(
    db: AsyncSession, principal: Principal, row: Vendor
) -> tuple[User, str]:
    """Mint a new password for the vendor's login and kill its sessions.

    Returns the account and the plaintext, because the caller has to email it
    and — if that fails — hand it back so somebody can pass it on. It is never
    logged and never stored anywhere but the bcrypt hash.

    This is the only way back in for a vendor who has forgotten theirs, since
    `/auth/change-password` needs the current one.

    Every outstanding refresh token is revoked, for the same reason a password
    change revokes them: whoever prompted the reset may be exactly who should
    stop having access.
    """
    account = await db.scalar(
        select(User)
        .join(Membership, Membership.user_id == User.id)
        .where(
            Membership.company_id == row.company_id,
            Membership.vendor_id == row.id,
            Membership.deleted_at.is_(None),
            User.role == VENDOR,
            User.deleted_at.is_(None),
        )
    )
    if account is None:
        raise _conflict(f"{row.name} has no login to reset")
    if not account.email:
        raise _conflict(f"{row.name}'s login has no email address to send a password to")

    password = generate_temporary_password()
    account.password_hash = hash_password(password)
    account.updated_by = principal.user_id
    await revoke_refresh_tokens(db, account.id)
    return account, password


async def update_vendor(
    db: AsyncSession,
    principal: Principal,
    vendor_id: uuid.UUID,
    body: VendorUpdateRequest,
) -> VendorOut:
    row = await _load(db, principal.company_id, vendor_id)

    if body.name is not None:
        name = body.name.strip()
        await _assert_name_free(db, principal.company_id, name, exclude_id=vendor_id)
        row.name = name
    # Only when it actually CHANGES. Checking it unconditionally would block
    # every other edit to a vendor that already holds a GSTIN it should not —
    # a row this rule was never meant to freeze, only to stop being created.
    if body.gstNumber is not None and body.gstNumber.lower() != row.gst_number.lower():
        await assert_gstin_free_for_vendor(
            db, principal.company_id, body.gstNumber, exclude_id=vendor_id
        )
        row.gst_number = body.gstNumber
    # The clearable fields: an explicit null means "empty this", where omitting
    # the key means "leave it alone". Truthiness cannot tell those apart.
    if "cin" in body.model_fields_set:
        row.cin = body.cin
    if "pan" in body.model_fields_set:
        row.pan = body.pan
    if "gstCompanyStatus" in body.model_fields_set:
        row.gst_company_status = body.gstCompanyStatus
    if body.contactPerson is not None:
        row.contact_person = body.contactPerson.strip()
    if body.phone is not None:
        row.phone = body.phone
    if body.address is not None:
        row.address = body.address
    if body.city is not None:
        row.city = body.city
    if body.state is not None:
        row.state = body.state
    if body.pincode is not None:
        row.pincode = body.pincode
    if body.intakeChannels is not None:
        # A new list, not a mutation: SQLAlchemy does not track JSONB in place.
        row.intake_channels = list(body.intakeChannels)
    if body.isActive is not None:
        row.is_active = body.isActive
    if body.addressSearchEnabled is not None:
        row.address_search_enabled = body.addressSearchEnabled
    if body.locationCheckEnabled is not None:
        row.location_check_enabled = body.locationCheckEnabled
    row.updated_by = principal.user_id

    await db.commit()
    return await _one(db, principal.company_id, row)


async def delete_vendor(
    db: AsyncSession, principal: Principal, vendor_id: uuid.UUID
) -> None:
    row = await _load(db, principal.company_id, vendor_id)

    branded = (await _model_counts(db, [vendor_id])).get(vendor_id, 0)
    if branded:
        raise _conflict(
            f"{row.name} is the brand on {branded} product model"
            f"{'' if branded == 1 else 's'}. Reassign them first."
        )

    now = _now()
    row.deleted_at = now
    row.is_active = False
    row.updated_by = principal.user_id

    # Close the accounts with it. Without this the vendor and its sub-users keep
    # authenticating against a vendor that no longer exists, and the first thing
    # they try refuses with "Unknown or inactive vendor" — incomprehensible to
    # someone who IS that vendor.
    #
    # The memberships are soft-deleted rather than the users: an identity may
    # belong to a vendor in another company, and it authored ticket history here
    # that must keep its author.
    accounts = (
        await db.scalars(
            select(Membership).where(
                Membership.company_id == row.company_id,
                Membership.vendor_id == row.id,
                Membership.deleted_at.is_(None),
            )
        )
    ).all()
    for membership in accounts:
        membership.is_active = False
        membership.deleted_at = now
        membership.updated_by = principal.user_id
        await revoke_refresh_tokens(db, membership.user_id)

    await db.commit()


# ── usage ─────────────────────────────────────────────────────────────────────


async def record_address_search(
    db: AsyncSession, principal: Principal, body: AddressSearchRequest
) -> None:
    """Record one Google autocomplete session the portal just ran.

    Google is called straight from the browser, so nothing reaches this API on
    its own and a search cannot be counted after the fact. This is the portal
    saying it happened.

    ## One statement, and no SELECT

    Called on a keystroke — the first one of a session, once the suggestions
    come back — so it does the least a write can do. The composite FK already
    proves `(company_id, vendor_id)` is a real pair, and `require_vendor_principal`
    already refused a portal account whose membership names no vendor, so there
    is nothing left worth reading first.

    ## Why ON CONFLICT DO NOTHING rather than a plain insert

    A duplicate must be a silent no-op. `app.core.errors` turns an
    `IntegrityError` into a 409, and a vendor typing a customer's address is the
    last person who should see one. The UNIQUE plus this clause is what makes a
    retried request, a double-fired debounce and a replay after a token refresh
    all land on the row that is already there.

    ## It does NOT check `address_search_enabled`

    Deliberate. A call arriving while the flag is off is either a tab opened
    before somebody switched it — a real Google session we were really billed
    for — or a forgery. Refusing would drop the honest one and under-report
    exactly when a person is investigating what the vendor is costing.

    ## The forgery it accepts

    A vendor can inflate its OWN number by posting in a loop. Accepted, because
    the purpose is visibility, not billing and not enforcement. What it cannot
    do is the part that matters: it cannot deflate the count (append-only, and
    no route deletes), cannot touch another vendor's (`principal.vendor_id` is
    server-side, never a field), and cannot spend money — recording a search is
    not making one. The cost of abuse is rows. If that ever matters, the answer
    is a ceiling that still answers 200, never a 429 the client can read and
    never a stored counter.
    """
    stmt = (
        pg_insert(VendorAddressSearch)
        .values(
            company_id=principal.company_id,
            vendor_id=principal.vendor_id,
            search_session_id=body.sessionId,
            created_by=principal.user_id,
        )
        .on_conflict_do_nothing(constraint="uq_vendor_address_searches_session")
    )
    await db.execute(stmt)
    await db.commit()
