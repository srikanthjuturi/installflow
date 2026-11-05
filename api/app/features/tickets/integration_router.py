"""The CRM-facing ticket API — `/integration/tickets`.

Lives in the tickets slice, beside the importer, because it is ticket intake (hard
rule 4: slices never import each other, and this must call the ticket service).
The credentials slice owns `/integration/token`; the guard that authorises every
call here is `core.integration_auth`.

Every call from a known credential is written to the call log, success or
refusal, with the request summary redacted (see `core.integration_log`).
"""

import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.errors import AppError
from app.core.integration_auth import IntegrationContext, integration_guard
from app.core.integration_errors import refusal
from app.core.integration_log import record_call, summarize_ticket_request
from app.core.schemas import ApiEnvelope, envelope
from app.features.tickets import integration_service
from app.features.tickets import integration_tracking
from app.features.tickets.integration_schemas import (
    IntegrationTicketCreate,
    IntegrationTicketPage,
    IntegrationTicketReply,
    IntegrationTicketView,
)

router = APIRouter(prefix="/integration", tags=["integration"])

Db = Annotated[AsyncSession, Depends(get_db)]
CanCreate = Annotated[IntegrationContext, Depends(integration_guard("create_ticket"))]


def _elapsed_ms(ctx: IntegrationContext) -> int:
    return int(
        (datetime.datetime.now(datetime.timezone.utc) - ctx.started).total_seconds() * 1000
    )


def _as_app_error(exc: HTTPException) -> AppError:
    """A refusal from the shared ticket path that carries no code of its own.

    The words are kept (they are the same ones the portal shows); the code is the
    general one for "this request cannot be accepted".
    """
    if isinstance(exc, AppError):
        return exc
    detail = exc.detail if isinstance(exc.detail, str) else "The request was refused."
    return AppError(exc.status_code, "VALIDATION_ERROR", detail)


@router.post("/tickets", response_model=ApiEnvelope[IntegrationTicketReply])
async def create_ticket(
    request: Request, response: Response, db: Db, ctx: CanCreate
) -> ApiEnvelope[IntegrationTicketReply]:
    """Raise one ticket from a vendor's CRM.

    The body is read here, not bound by FastAPI, so a malformed one gets this API's
    own `VALIDATION_ERROR` envelope with a line per field.
    """
    raw: Any = None
    summary: dict[str, Any] = {}
    reference: str | None = None
    check_only = False

    async def refused(exc: HTTPException) -> AppError:
        err = _as_app_error(exc)
        await record_call(
            db,
            company_id=ctx.company_id,
            vendor_id=ctx.vendor_id,
            credential_id=ctx.credential_id,
            endpoint="create_ticket",
            http_status=err.status_code,
            outcome_code=err.code,
            check_only=check_only,
            crm_reference=reference,
            detail=summary or None,
            duration_ms=_elapsed_ms(ctx),
        )
        return err

    try:
        raw = await request.json()
    except ValueError:
        raise await refused(
            refusal("VALIDATION_ERROR", errors=["body: must be a JSON object"])
        ) from None
    if not isinstance(raw, dict):
        raise await refused(
            refusal("VALIDATION_ERROR", errors=["body: must be a JSON object"])
        )
    summary = summarize_ticket_request(raw)
    reference = str(raw.get("reference") or "")[:64] or None
    check_only = bool(raw.get("checkOnly"))

    try:
        body = IntegrationTicketCreate.model_validate(raw)
    except ValidationError as exc:
        raise await refused(
            refusal(
                "VALIDATION_ERROR",
                errors=integration_service.validation_lines(exc),
            )
        ) from None

    try:
        reply, ticket_id, http_status = await integration_service.create_for_crm(
            db, ctx, body
        )
    except HTTPException as exc:
        raise await refused(exc) from None

    await record_call(
        db,
        company_id=ctx.company_id,
        vendor_id=ctx.vendor_id,
        credential_id=ctx.credential_id,
        endpoint="create_ticket",
        http_status=http_status,
        check_only=reply.checkOnly,
        crm_reference=reply.reference,
        ticket_id=ticket_id,
        repeat=reply.repeat,
        detail=summary or None,
        duration_ms=_elapsed_ms(ctx),
    )
    response.status_code = http_status
    message = (
        "This reference already has a ticket"
        if reply.repeat
        else "Checked: this ticket would be accepted"
        if reply.checkOnly
        else "Ticket created"
    )
    return envelope(reply, message=message, status_code=http_status)


CanReadOne = Annotated[IntegrationContext, Depends(integration_guard("get_ticket"))]
CanList = Annotated[IntegrationContext, Depends(integration_guard("list_tickets"))]


async def _read_logged(
    db: AsyncSession,
    ctx: IntegrationContext,
    endpoint: str,
    reference: str | None,
    ticket_id_of,
    call,
):
    """Run a read, writing its call-log row whether it answers or refuses."""
    try:
        result = await call()
    except HTTPException as exc:
        err = _as_app_error(exc)
        await record_call(
            db,
            company_id=ctx.company_id,
            vendor_id=ctx.vendor_id,
            credential_id=ctx.credential_id,
            endpoint=endpoint,
            http_status=err.status_code,
            outcome_code=err.code,
            crm_reference=reference,
            duration_ms=_elapsed_ms(ctx),
        )
        raise err from None
    await record_call(
        db,
        company_id=ctx.company_id,
        vendor_id=ctx.vendor_id,
        credential_id=ctx.credential_id,
        endpoint=endpoint,
        http_status=200,
        crm_reference=reference,
        ticket_id=ticket_id_of(result),
        duration_ms=_elapsed_ms(ctx),
    )
    return result


# NB the list route is declared BEFORE `/{ident}`, or "tickets" would be read as an id.
@router.get("/tickets", response_model=ApiEnvelope[IntegrationTicketPage])
async def list_changed_tickets(
    db: Db,
    ctx: CanList,
    changedSince: Annotated[str, Query(description="ISO 8601 date and time")],
    cursor: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=integration_tracking.MAX_LIMIT)] = (
        integration_tracking.DEFAULT_LIMIT
    ),
    include: Annotated[str | None, Query()] = None,
) -> ApiEnvelope[IntegrationTicketPage]:
    """Every ticket of this vendor that changed after `changedSince`."""
    since = integration_tracking.parse_since(changedSince)
    page = await _read_logged(
        db,
        ctx,
        "list_tickets",
        None,
        lambda _r: None,
        lambda: integration_tracking.list_changed(
            db,
            ctx,
            changed_since=since,
            cursor=cursor,
            limit=limit,
            with_timeline=include == "timeline",
        ),
    )
    return envelope(page)


@router.get("/tickets/{ident}", response_model=ApiEnvelope[IntegrationTicketView])
async def get_ticket(
    ident: str, db: Db, ctx: CanReadOne
) -> ApiEnvelope[IntegrationTicketView]:
    """One ticket, by our ticket number or the CRM's own reference."""
    view = await _read_logged(
        db,
        ctx,
        "get_ticket",
        ident[:64],
        lambda _r: None,
        lambda: integration_tracking.get_one(db, ctx, ident),
    )
    return envelope(view)
