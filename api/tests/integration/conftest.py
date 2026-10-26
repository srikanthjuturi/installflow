"""Integration test setup — cleans up leftover IntTest franchisees before each
session so tests are idempotent when run repeatedly against the dev DB."""

import asyncio
import sys

import pytest

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy import delete, select

from app.core.database import AsyncSessionLocal
from app.models.company import Company
from app.models.franchisee import Franchisee, FranchiseePincode


async def _cleanup():
    async with AsyncSessionLocal() as db:
        company = await db.scalar(
            select(Company).where(
                Company.name.like("Seed Appliances%"),
                Company.deleted_at.is_(None),
            )
        )
        if company is None:
            return
        rows = (
            await db.execute(
                select(Franchisee).where(
                    Franchisee.company_id == company.id,
                    Franchisee.name.like("IntTest%"),
                    Franchisee.deleted_at.is_(None),
                )
            )
        ).scalars().all()
        for row in rows:
            await db.execute(
                delete(FranchiseePincode).where(
                    FranchiseePincode.franchisee_id == row.id
                )
            )
            row.deleted_at = row.updated_at
        await db.commit()
        if rows:
            print(f"\n[conftest] cleaned up {len(rows)} leftover IntTest franchisee(s)")


@pytest.fixture(scope="session", autouse=True)
def cleanup_inttest_franchisees():
    asyncio.run(_cleanup())
    yield
    asyncio.run(_cleanup())
