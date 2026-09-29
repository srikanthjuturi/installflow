"""Vendor credit — the company's side: the lines, the payments, the requests.

**`vendors.credit` plus a National-Head rank floor**, both, for the reason
`credits/router.py` gives: the feature key is what the console reads to draw the
rail entry and is seeded to Admin and National Head, and the rank floor is what
survives somebody handing the key to a Regional Head on Feature Access.
Confirming a payment moves money, and raising a line extends credit.

**Confirming is the one thing that restores a vendor's headroom**, and it lives
only here. The vendor claims; these routes decide. Two words, two people — the
split a recharge has one level up and a redemption one level down.

`/count` and `/vendors` are declared BEFORE `/payments/{payment_id}` for the
usual reason: a literal segment sitting under a `uuid.UUID` path parameter is
parsed as one and 422s.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import Principal, require_feature, require_min_rank
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
    PAYMENT_STATES,
    REQUEST_STATUSES,
    LimitApproveRequest,
    PaymentCountOut,
    RecordPaymentRequest,
    RejectRequest,
    VendorCreditRequestOut,
    VendorPaymentDetailOut,
    VendorPaymentOut,
    VendorStandingOut,
)
from app.models.role import NATIONAL_HEAD

router = APIRouter(prefix="/vendor-credit", tags=["vendor-credit"])

Db = Annotated[AsyncSession, Depends(get_db)]
Params = Annotated[ListParams, Depends(list_params)]
CanManage = Annotated[Principal, Depends(require_feature("vendors.credit"))]
HeadRoute = [Depends(require_min_rank(NATIONAL_HEAD))]


@router.get(
    "/count", response_model=ApiEnvelope[PaymentCountOut], dependencies=HeadRoute
)
async def waiting_count(db: Db, principal: CanManage) -> ApiEnvelope[PaymentCountOut]:
    """The two badges: claims waiting, and limit requests waiting.

    Two numbers rather than one, because they are different work — money that
    may have arrived, and a policy decision — and a single badge would send
    somebody to the wrong tab.
    """
    assert principal.company_id is not None
    return envelope(await service.counts(db, principal.company_id))


@router.get(
    "/vendors",
    response_model=PaginatedEnvelope[VendorStandingOut],
    dependencies=HeadRoute,
)
async def vendor_lines(
    db: Db,
    principal: CanManage,
    params: Params,
    pausedOnly: Annotated[bool, Query()] = False,
) -> PaginatedEnvelope[VendorStandingOut]:
    """Every vendor's line, by name.

    `pausedOnly` filters the PAGE, not the query — see `service.vendors_page`
    for why, and for what the total then means.
    """
    assert principal.company_id is not None
    rows, total = await service.vendors_page(
        db, principal.company_id, params, paused_only=pausedOnly
    )
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.get(
    "/vendors/{vendor_id}",
    response_model=ApiEnvelope[VendorStandingOut],
    dependencies=HeadRoute,
)
async def vendor_line(
    vendor_id: uuid.UUID, db: Db, principal: CanManage
) -> ApiEnvelope[VendorStandingOut]:
    """One vendor's line. A guess at another company's vendor is a 404."""
    assert principal.company_id is not None
    return envelope(await service.vendor_line(db, principal.company_id, vendor_id))


@router.post(
    "/vendors/{vendor_id}/payments",
    response_model=ApiEnvelope[VendorPaymentDetailOut],
    status_code=201,
    dependencies=HeadRoute,
)
async def record_payment(
    vendor_id: uuid.UUID,
    body: RecordPaymentRequest,
    db: Db,
    principal: CanManage,
) -> ApiEnvelope[VendorPaymentDetailOut]:
    """Write down money that arrived by NEFT, RTGS, cheque, cash — anything but
    the QR.

    The ONE door here that moves a line on one person's word, because a bank
    statement is the only evidence such a payment leaves on our side and the
    vendor is not a second observer waiting to be asked. The row records
    `source='staff'` so the trail never confuses it with a claim the vendor made.

    Uncapped, needs no UPI ID on the company, and final the moment it is written.
    409 `UTR_ALREADY_CREDITED` when the reference is already on a credited
    payment; 422 `BAD_PROOF` for an attachment from another account.
    """
    return envelope(
        await service.record_payment(db, principal, vendor_id, body),
        message="Payment recorded",
        status_code=201,
    )


@router.get(
    "/payments",
    response_model=PaginatedEnvelope[VendorPaymentOut],
    dependencies=HeadRoute,
)
async def payments(
    db: Db,
    principal: CanManage,
    params: Params,
    state: Annotated[str | None, Query()] = None,
    vendorId: Annotated[uuid.UUID | None, Query()] = None,
) -> PaginatedEnvelope[VendorPaymentOut]:
    """The queue, or one vendor's history.

    `state=waiting` sorts OLDEST first — it is a queue, and the claim that has
    waited longest is the one somebody owes an answer to. Everything else is
    history and reads newest first.
    """
    wanted = canonical_filter(state, PAYMENT_STATES)
    if wanted is False:
        return paginated([], page=params.page, limit=params.limit, total=0)
    assert principal.company_id is not None
    rows, total = await service.payments_page(
        db, principal.company_id, params, vendor_id=vendorId, state=wanted
    )
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.get(
    "/payments/{payment_id}",
    response_model=ApiEnvelope[VendorPaymentDetailOut],
    dependencies=HeadRoute,
)
async def payment(
    payment_id: uuid.UUID, db: Db, principal: CanManage
) -> ApiEnvelope[VendorPaymentDetailOut]:
    """One payment, with a signed link to the screenshot.

    `upiUri` is always null here: staff are the payee, so a QR would be asking
    them to pay themselves.
    """
    assert principal.company_id is not None
    return envelope(await service.payment_detail(db, principal.company_id, payment_id))


@router.post(
    "/payments/{payment_id}/confirm",
    response_model=ApiEnvelope[VendorPaymentDetailOut],
    dependencies=HeadRoute,
)
async def confirm(
    payment_id: uuid.UUID, db: Db, principal: CanManage
) -> ApiEnvelope[VendorPaymentDetailOut]:
    """It arrived. THE one thing that restores the vendor's headroom.

    Idempotent — a second press returns the same payment rather than a 409.
    409 `NOT_WAITING` when it is not a claim, `UTR_ALREADY_CREDITED` when that
    reference has already been credited on another payment.
    """
    return envelope(
        await service.confirm_payment(db, principal, payment_id),
        message="Payment confirmed",
    )


@router.post(
    "/payments/{payment_id}/reject",
    response_model=ApiEnvelope[VendorPaymentDetailOut],
    dependencies=HeadRoute,
)
async def reject(
    payment_id: uuid.UUID, body: RejectRequest, db: Db, principal: CanManage
) -> ApiEnvelope[VendorPaymentDetailOut]:
    """It did not arrive, or did not match. Final, and the reason reaches the
    vendor. There is no partial credit in this product."""
    return envelope(
        await service.reject_payment(db, principal, payment_id, body),
        message="Payment rejected",
    )


@router.get(
    "/limit-requests",
    response_model=PaginatedEnvelope[VendorCreditRequestOut],
    dependencies=HeadRoute,
)
async def limit_requests(
    db: Db,
    principal: CanManage,
    params: Params,
    status: Annotated[str | None, Query()] = None,
) -> PaginatedEnvelope[VendorCreditRequestOut]:
    """Pending first, longest-waiting within it; decided after, newest first."""
    wanted = canonical_filter(status, REQUEST_STATUSES)
    if wanted is False:
        return paginated([], page=params.page, limit=params.limit, total=0)
    assert principal.company_id is not None
    rows, total = await service.requests_page(
        db, principal.company_id, params, status=wanted
    )
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.post(
    "/limit-requests/{request_id}/approve",
    response_model=ApiEnvelope[VendorCreditRequestOut],
    dependencies=HeadRoute,
)
async def approve(
    request_id: uuid.UUID, body: LimitApproveRequest, db: Db, principal: CanManage
) -> ApiEnvelope[VendorCreditRequestOut]:
    """Grant a line, at the figure decided here rather than the one asked for.

    Writes `vendors.credit_limit_paise` in the same transaction as the decision.
    409 `ALREADY_DECIDED` when somebody else got there first.
    """
    return envelope(
        await service.approve_request(db, principal, request_id, body),
        message="Credit limit updated",
    )


@router.post(
    "/limit-requests/{request_id}/reject",
    response_model=ApiEnvelope[VendorCreditRequestOut],
    dependencies=HeadRoute,
)
async def reject_limit(
    request_id: uuid.UUID, body: RejectRequest, db: Db, principal: CanManage
) -> ApiEnvelope[VendorCreditRequestOut]:
    """Turn it down, with the reason the vendor will read on their own page."""
    return envelope(
        await service.reject_request(db, principal, request_id, body),
        message="Request rejected",
    )
