"""Idempotent superadmin bootstrap.

    python -m app.scripts.bootstrap

Creates the platform superadmin from SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD in
.env if one does not already exist. Safe to run repeatedly.
"""

import asyncio
import sys
import warnings

if sys.platform == "win32":
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy import func, select  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.models import User  # noqa: E402
from app.models.role import SUPERADMIN  # noqa: E402


async def bootstrap() -> None:
    email = settings.SUPERADMIN_EMAIL.strip()
    async with AsyncSessionLocal() as session:
        existing = await session.scalar(
            select(User).where(func.lower(User.email) == email.lower())
        )
        if existing is not None:
            note = "" if existing.role == SUPERADMIN else f" (role={existing.role}!)"
            print(f"Superadmin already exists: {existing.email}{note}")
            return

        user = User(
            email=email,
            password_hash=hash_password(settings.SUPERADMIN_PASSWORD),
            full_name=settings.SUPERADMIN_NAME,
            role=SUPERADMIN,
            is_active=True,
        )
        session.add(user)
        await session.commit()
        print(f"Created superadmin: {email}")


if __name__ == "__main__":
    asyncio.run(bootstrap())
