"""A vendor's own credit line — the portal's side.

**`vendor.credit` plus `IsVendor`, and deliberately no rank floor.** A vendor
ranks below every staff role (`ROLE_RANKS`), so a seniority floor here would be
exactly backwards — the same reasoning
`vendors.router.record_address_search` spells out. `IsVendor` on top of the
feature key for the reason `POST /tickets` carries it: a feature grant is
overridable per company, so on the key alone "vendor-only" lasts until somebody
flips a row.

`vendor.credit` is seeded to `vendor` and NOT to `vendor_user` — the line
`vendor.users` and `vendor.catalogue` already draw. A sub-user raises tickets;
settling with the company is a vendor-admin act. A sub-user still learns that
intake is paused, because `GET /tickets/intake-status` is on `jobs.create`.

**There is no route here that clears what the vendor owes.** It claims it paid;
only an Admin or National Head confirms (`staff_router.py`).

Every path is `/me`. Nothing takes a vendor id from the client — it comes from
`principal.vendor_id`, re-derived per request from the membership this request
already loaded (hard rule 0).
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import Principal, require_feature, require_vendor_principal
from app.core.schemas import (
    ApiEnvelope,
    ListParams,
    PaginatedEnvelope,
    canonical_filter,
    envelope,
    list_params,
    paginated,
)
from app.features.vendor_credits import service
from app.features.vendor_credits.schemas import (
    ENTRY_KINDS,
    PAYMENT_STATES,
    LimitRequestIn,
    PaymentClaimRequest,
    PaymentRequest,
    VendorCreditEntryOut,
    VendorCreditOut,
    VendorCreditRequestOut,
    VendorPaymentDetailOut,
    VendorPaymentOut,
)

router = APIRouter(prefix="/vendor-credit", tags=["vendor-credit"])

Db = Annotated[AsyncSession, Depends(get_db)]
Params = Annotated[ListParams, Depends(list_params)]
CanPay = Annotated[Principal, Depends(require_feature("vendor.credit"))]
IsVendor = Depends(require_vendor_principal)


@router.get("/me", response_model=ApiEnvelope[VendorCreditOut], dependencies=[IsVendor])
async def my_credit(db: Db, principal: CanPay) -> ApiEnvelope[VendorCreditOut]:
    """The line: limit, owed, reserved, available — and what can be done next.

    A vendor DOES see its own figures, which departs from the rule that a spend
    figure is a console figure. `VendorCreditOut` argues why.
    """
    return envelope(await service.me(db, principal))


@router.get(
    "/me/entries",
    response_model=PaginatedEnvelope[VendorCreditEntryOut],
    dependencies=[IsVendor],
)
async def my_entries(
    db: Db,
    principal: CanPay,
    params: Params,
    kind: Annotated[str | None, Query()] = None,
) -> PaginatedEnvelope[VendorCreditEntryOut]:
    """The statement. An unknown `kind` gives an empty page, never a 422 — the
    filter arrives from a shareable query string, so an old bookmark must not
    break the screen."""
    wanted = canonical_filter(kind, ENTRY_KINDS)
    if wanted is False:
        return paginated([], page=params.page, limit=params.limit, total=0)
    assert principal.company_id is not None and principal.vendor_id is not None
    rows, total = await service.entries_page(
        db, principal.company_id, principal.vendor_id, params, kind=wanted
    )
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.get(
    "/me/payments",
    response_model=PaginatedEnvelope[VendorPaymentOut],
    dependencies=[IsVendor],
)
async def my_payments(
    db: Db,
    principal: CanPay,
    params: Params,
    state: Annotated[str | None, Query()] = None,
) -> PaginatedEnvelope[VendorPaymentOut]:
    wanted = canonical_filter(state, PAYMENT_STATES)
    if wanted is False:
        return paginated([], page=params.page, limit=params.limit, total=0)
    assert principal.company_id is not None
    rows, total = await service.payments_page(
        db,
        principal.company_id,
        params,
        vendor_id=principal.vendor_id,
        state=wanted,
    )
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.post(
    "/me/payments",
    response_model=ApiEnvelope[VendorPaymentDetailOut],
    status_code=201,
    dependencies=[IsVendor],
)
async def start_payment(
    body: PaymentRequest, db: Db, principal: CanPay
) -> ApiEnvelope[VendorPaymentDetailOut]:
    """Ask to pay, and get the QR back with it.

    409 `PAYMENT_UNAVAILABLE` when the company has not said where to send money,
    `PAYMENT_OPEN` when one is already open, `NOTHING_TO_PAY` when nothing is
    owed; 422 `BAD_AMOUNT` when the figure is above what is owed or is not whole
    rupees.
    """
    return envelope(
        await service.create_payment(db, principal, body),
        message="Pay the QR, then tell us the reference",
        status_code=201,
    )


@router.get(
    "/me/payments/{payment_id}",
    response_model=ApiEnvelope[VendorPaymentDetailOut],
    dependencies=[IsVendor],
)
async def my_payment(
    payment_id: uuid.UUID, db: Db, principal: CanPay
) -> ApiEnvelope[VendorPaymentDetailOut]:
    """One payment. `upiUri` is present only while it is still to pay."""
    return envelope(await service.own_payment_detail(db, principal, payment_id))


@router.post(
    "/me/payments/{payment_id}/claim",
    response_model=ApiEnvelope[VendorPaymentDetailOut],
    dependencies=[IsVendor],
)
async def claim(
    payment_id: uuid.UUID, body: PaymentClaimRequest, db: Db, principal: CanPay
) -> ApiEnvelope[VendorPaymentDetailOut]:
    """"I have paid" — the UTR and the screenshot. Idempotent."""
    return envelope(
        await service.claim_payment(db, principal, payment_id, body),
        message="Sent for confirmation",
    )


@router.post(
    "/me/payments/{payment_id}/cancel",
    response_model=ApiEnvelope[VendorPaymentDetailOut],
    dependencies=[IsVendor],
)
async def cancel(
    payment_id: uuid.UUID, db: Db, principal: CanPay
) -> ApiEnvelope[VendorPaymentDetailOut]:
    """Withdraw it — only before claiming. 409 `ALREADY_CLAIMED` after."""
    return envelope(
        await service.cancel_payment(db, principal, payment_id),
        message="Payment withdrawn",
    )


@router.get(
    "/me/limit-requests",
    response_model=ApiEnvelope[list[VendorCreditRequestOut]],
    dependencies=[IsVendor],
)
async def my_requests(
    db: Db, principal: CanPay
) -> ApiEnvelope[list[VendorCreditRequestOut]]:
    """Every request this vendor has made, newest first. One pending at a time,
    so this is short by construction and not paged."""
    return envelope(await service.own_requests(db, principal))


@router.post(
    "/me/limit-requests",
    response_model=ApiEnvelope[VendorCreditRequestOut],
    status_code=201,
    dependencies=[IsVendor],
)
async def ask_for_more(
    body: LimitRequestIn, db: Db, principal: CanPay
) -> ApiEnvelope[VendorCreditRequestOut]:
    """Ask for a bigger line. 409 `REQUEST_PENDING` when one is already waiting;
    422 `BAD_AMOUNT` when the figure is not above the line they have."""
    return envelope(
        await service.request_limit(db, principal, body),
        message="Sent for approval",
        status_code=201,
    )


@router.post(
    "/me/limit-requests/{request_id}/withdraw",
    response_model=ApiEnvelope[VendorCreditRequestOut],
    dependencies=[IsVendor],
)
async def withdraw(
    request_id: uuid.UUID, db: Db, principal: CanPay
) -> ApiEnvelope[VendorCreditRequestOut]:
    """Take a pending request back, so a different amount can be asked for.

    A POST rather than a DELETE: the row is kept, its status changes, and the
    history of what was asked and withdrawn is worth keeping.
    """
    return envelope(
        await service.withdraw_request(db, principal, request_id),
        message="Request withdrawn",
    )
