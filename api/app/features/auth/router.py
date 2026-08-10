"""Auth endpoints: login, switch-company, refresh, logout, me."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import CurrentPrincipal
from app.core.schemas import ApiEnvelope, envelope
from app.features.auth import otp_service, service
from app.features.auth.schemas import (
    LoginRequest,
    LoginResponse,
    LogoutRequest,
    MeResponse,
    OtpRequestRequest,
    OtpRequestResponse,
    OtpVerifyRequest,
    RefreshRequest,
    RefreshResponse,
    SwitchCompanyRequest,
    SwitchCompanyResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])

Db = Annotated[AsyncSession, Depends(get_db)]


@router.post("/login", response_model=ApiEnvelope[LoginResponse])
async def login(body: LoginRequest, db: Db) -> ApiEnvelope[LoginResponse]:
    data = await service.login(db, body.email, body.password)
    return envelope(data, message="Logged in")


@router.post("/otp/request", response_model=ApiEnvelope[OtpRequestResponse])
async def request_otp(
    body: OtpRequestRequest, request: Request, db: Db
) -> ApiEnvelope[OtpRequestResponse]:
    """Send a technician a sign-in code. Unauthenticated by nature."""
    client = request.client.host if request.client else None
    data = await otp_service.request_login_code(db, body.phone, client)
    return envelope(data, message="Code sent" if data.sent else "Code could not be sent")


@router.post("/otp/verify", response_model=ApiEnvelope[LoginResponse])
async def verify_otp(body: OtpVerifyRequest, db: Db) -> ApiEnvelope[LoginResponse]:
    """Exchange a code for the same token pair `/auth/login` issues."""
    data = await otp_service.verify_login_code(db, body.phone, body.code)
    return envelope(data, message="Signed in")


@router.post("/switch-company", response_model=ApiEnvelope[SwitchCompanyResponse])
async def switch_company(
    body: SwitchCompanyRequest, principal: CurrentPrincipal, db: Db
) -> ApiEnvelope[SwitchCompanyResponse]:
    data = await service.switch_company(db, principal, body.companyId)
    return envelope(data, message="Company switched")


@router.post("/refresh", response_model=ApiEnvelope[RefreshResponse])
async def refresh(body: RefreshRequest, db: Db) -> ApiEnvelope[RefreshResponse]:
    data = await service.refresh_tokens(db, body.refreshToken)
    return envelope(data, message="Token refreshed")


@router.post("/logout", response_model=ApiEnvelope[None])
async def logout(
    body: LogoutRequest, principal: CurrentPrincipal, db: Db
) -> ApiEnvelope[None]:
    await service.logout(db, principal.user_id, body.refreshToken)
    return envelope(None, message="Logged out")


@router.get("/me", response_model=ApiEnvelope[MeResponse])
async def me(principal: CurrentPrincipal, db: Db) -> ApiEnvelope[MeResponse]:
    data = await service.get_me(db, principal)
    return envelope(data, message="Current user")
