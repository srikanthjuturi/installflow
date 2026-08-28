"""Auth endpoints: login, password reset, switch-company, refresh, logout, me."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import CurrentPrincipal
from app.core.schemas import ApiEnvelope, envelope
from app.features.auth import otp_service, service
from app.features.auth.schemas import (
    ChangePasswordRequest,
    GoogleLoginRequest,
    LoginRequest,
    LoginResponse,
    LogoutRequest,
    MeResponse,
    MeUpdateRequest,
    OtpRequestRequest,
    OtpRequestResponse,
    OtpVerifyRequest,
    PasswordResetConfirmRequest,
    PasswordResetRequestRequest,
    PasswordResetVerifyRequest,
    PasswordResetVerifyResponse,
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


@router.post("/google", response_model=ApiEnvelope[LoginResponse])
async def google_login(
    body: GoogleLoginRequest, db: Db
) -> ApiEnvelope[LoginResponse]:
    """Exchange a Google ID token for the same token pair `/auth/login` issues.

    Serves BOTH the "Continue with Google" button and One Tap — they produce the
    same credential, so nothing downstream knows which one it came from.

    Unauthenticated by nature, like `/login` and `/otp/*`. It never creates an
    account: an address Google verifies but this company has never heard of is a
    401, not a new user.
    """
    data = await service.google_login(db, body.credential)
    return envelope(data, message="Signed in")


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


@router.post(
    "/password-reset/request", response_model=ApiEnvelope[OtpRequestResponse]
)
async def request_password_reset(
    body: PasswordResetRequestRequest, request: Request, db: Db
) -> ApiEnvelope[OtpRequestResponse]:
    """Email a console account a code for a forgotten password.

    Unauthenticated by nature — the whole premise is that the caller cannot
    prove who they are yet. Throttled per address and per IP by the same
    counters the technician code path uses.
    """
    client = request.client.host if request.client else None
    data = await otp_service.request_password_reset(db, body.email, client)
    return envelope(
        data, message="Code sent" if data.sent else "Code could not be sent"
    )


@router.post(
    "/password-reset/verify", response_model=ApiEnvelope[PasswordResetVerifyResponse]
)
async def verify_password_reset(
    body: PasswordResetVerifyRequest, db: Db
) -> ApiEnvelope[PasswordResetVerifyResponse]:
    """Burn the code and answer with the ticket that authorises a new password.

    Deliberately not the last step. Telling somebody their code was right at the
    moment they type it, rather than after they have also chosen a password, is
    the reason this flow has three requests instead of two.
    """
    data = await otp_service.verify_password_reset(db, body.email, body.code)
    return envelope(data, message="Code verified")


@router.post("/password-reset/confirm", response_model=ApiEnvelope[LoginResponse])
async def confirm_password_reset(
    body: PasswordResetConfirmRequest, db: Db
) -> ApiEnvelope[LoginResponse]:
    """Set the new password and sign them in, ending every other session.

    Answers with the same payload `/auth/login` does: they proved the address a
    moment ago, so a second sign-in form would have nothing to establish.
    """
    data = await service.confirm_password_reset(db, body.resetToken, body.newPassword)
    return envelope(data, message="Password changed")


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


@router.patch("/me", response_model=ApiEnvelope[MeResponse])
async def update_me(
    body: MeUpdateRequest, principal: CurrentPrincipal, db: Db
) -> ApiEnvelope[MeResponse]:
    """Change your own profile photo.

    No feature guard: the subject is the caller. A technician has no console
    permissions at all and still owns their own face — the same reasoning that
    puts `POST /uploads` behind "any signed-in principal".
    """
    data = await service.update_me(db, principal, body)
    return envelope(data, message="Profile updated")

@router.post("/change-password", response_model=ApiEnvelope[LoginResponse])
async def change_password(
    body: ChangePasswordRequest, db: Db, principal: CurrentPrincipal
) -> ApiEnvelope[LoginResponse]:
    """Set a new password. No feature key — anyone may change their own.

    Answers with a fresh token pair, because every OTHER session is revoked:
    the caller stays signed in here and is signed out everywhere else. A wrong
    current password is a 400, never a 401 — see the service for why that
    distinction is load-bearing for the console.
    """
    result = await service.change_password(
        db, principal, body.currentPassword, body.newPassword
    )
    return envelope(result, message="Password changed")
