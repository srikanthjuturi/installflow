"""The one unauthenticated CRM endpoint: trade credentials for tokens.

`POST /integration/token`. No bearer token — this is where the CRM gets one. What
makes that safe: the secret is 256 random bits compared in constant time, a wrong
Client ID and a wrong secret read identically, a known credential is throttled
like every other call, and every call from a known credential is logged.
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.schemas import ApiEnvelope, envelope
from app.features.api_credentials import service
from app.features.api_credentials.schemas import TokenOut, TokenRequest

router = APIRouter(prefix="/integration", tags=["integration"])

Db = Annotated[AsyncSession, Depends(get_db)]


@router.post("/token", response_model=ApiEnvelope[TokenOut])
async def token(body: TokenRequest, db: Db) -> ApiEnvelope[TokenOut]:
    """A one-hour access token and a 30-day refresh token.

    Send `clientId` and `clientSecret` to sign in, or a `refreshToken` to renew
    without the secret. Using a refresh token ends it and returns a new one.
    """
    return envelope(await service.exchange(db, body), message="Token issued")
