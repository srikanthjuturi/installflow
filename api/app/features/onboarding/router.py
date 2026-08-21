"""Self-registration endpoints — reached from the invite deep link, no auth.

The registration token is read from the Authorization header rather than the
body so it looks like every other bearer credential, but it is decoded here
instead of by `get_current_principal`: that dependency rejects any token whose
type is not `access`, which is exactly the property that stops a registration
token being used as a session.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.schemas import (
    ApiEnvelope,
    ListParams,
    PaginatedEnvelope,
    envelope,
    list_params,
    paginated,
)
from app.features.auth.schemas import LoginResponse, OtpRequestResponse
from app.features.onboarding import service
from app.features.onboarding.schemas import (
    InviteResolveOut,
    OtpVerifyInviteRequest,
    RegistrationTokenOut,
    SelfRegisterRequest,
)

router = APIRouter(prefix="/onboarding", tags=["onboarding"])

Db = Annotated[AsyncSession, Depends(get_db)]
_bearer = HTTPBearer(auto_error=False)


def _registration_token(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> str:
    if creds is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Verify your mobile number before registering",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return creds.credentials


@router.get("/invites/{token}", response_model=ApiEnvelope[InviteResolveOut])
async def resolve_invite(token: str, db: Db) -> ApiEnvelope[InviteResolveOut]:
    return envelope(await service.resolve_invite(db, token))


@router.post("/invites/{token}/otp", response_model=ApiEnvelope[OtpRequestResponse])
async def request_invite_otp(
    token: str, request: Request, db: Db
) -> ApiEnvelope[OtpRequestResponse]:
    client = request.client.host if request.client else None
    data = await service.request_invite_code(db, token, client)
    return envelope(data, message="Code sent" if data.sent else "Code could not be sent")


@router.post(
    "/invites/{token}/otp/verify", response_model=ApiEnvelope[RegistrationTokenOut]
)
async def verify_invite_otp(
    token: str, body: OtpVerifyInviteRequest, db: Db
) -> ApiEnvelope[RegistrationTokenOut]:
    return envelope(await service.verify_invite_code(db, token, body.code))


@router.post(
    "/invites/{token}/register",
    response_model=ApiEnvelope[LoginResponse],
    status_code=201,
)
async def register(
    token: str,
    body: SelfRegisterRequest,
    db: Db,
    registration_token: Annotated[str, Depends(_registration_token)],
) -> ApiEnvelope[LoginResponse]:
    data = await service.register(db, token, registration_token, body)
    return envelope(data, message="Welcome aboard", status_code=201)
