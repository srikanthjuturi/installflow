"""FastAPI application factory.

Phase note: no business API routes yet. Feature routers will be included here
as they are built (e.g. `app.include_router(jobs.router, prefix=...)`).
"""

import asyncio
import sys
import warnings
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import text

from app.core.config import settings
from app.core.database import engine

# psycopg's async driver cannot run on Windows' default ProactorEventLoop.
# Select the SelectorEventLoop before any loop is created (import time). NB: for
# the reloading `uvicorn` server the policy must be set even earlier — see run.py.
if sys.platform == "win32":
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Verify DB connectivity on startup — fail fast if unreachable.
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    yield
    await engine.dispose()


app = FastAPI(
    title=settings.PROJECT_NAME,
    debug=settings.DEBUG,
    lifespan=lifespan,
)


@app.get("/health", tags=["meta"])
async def health() -> dict[str, str]:
    return {"status": "ok", "environment": settings.ENVIRONMENT}


# Feature routers are included below as they are built:
# app.include_router(jobs.router, prefix=settings.API_V1_PREFIX)
