"""Ending somebody's sessions.

Lives in `core/` rather than the auth slice because three slices need it and
hard rule 4 forbids one importing another: auth on sign-out and on a password
change, vendors when a National Head reissues a vendor's password, and users
when an account is suspended.

An access token is NOT revoked here, and cannot be — it is a self-contained JWT
that stays valid until it expires. `ACCESS_TOKEN_EXPIRE_MINUTES` is therefore
the real window on any of these actions, and it is 30 minutes. What this closes
is the seven-day one.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_token
from app.models.token import RefreshToken


async def revoke_refresh_tokens(
    session: AsyncSession, user_id: uuid.UUID, *, raw_token: str | None = None
) -> int:
    """Revoke this user's live refresh tokens, and say how many.

    `raw_token` narrows it to one — signing out of this device only. Omitting it
    revokes every session the user has anywhere, which is what a password change
    or a reset wants: whoever prompted it may be exactly who should stop having
    access.

    Does NOT commit. The caller owns the transaction, so the revocation lands
    with the change that caused it rather than separately — a crash between the
    two would otherwise leave a new password with the old sessions still live.
    """
    now = datetime.now(timezone.utc)
    stmt = select(RefreshToken).where(
        RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None)
    )
    if raw_token:
        stmt = stmt.where(RefreshToken.token_hash == hash_token(raw_token))

    rows = (await session.scalars(stmt)).all()
    for row in rows:
        row.revoked_at = now
    return len(rows)
