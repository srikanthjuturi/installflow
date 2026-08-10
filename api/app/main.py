"""FastAPI application factory."""

import asyncio
import sys
import warnings
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.router import api_router
from app.core.config import settings
from app.core.database import engine
from app.core.errors import register_exception_handlers

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


# NB: `debug=` is deliberately NOT passed. Starlette's error middleware returns
# a raw HTML traceback when debug is on, bypassing our exception handlers — so
# the client would get a stack trace instead of the standard error envelope, and
# the console would fail to parse it. The traceback is still logged server-side
# by the handler in app.core.errors, which is where a developer should read it.
app = FastAPI(
    title=settings.PROJECT_NAME,
    lifespan=lifespan,
)

register_exception_handlers(app)

# Browser clients (the adminWeb console) call this API cross-origin in dev.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["meta"])
async def health() -> dict[str, str]:
    return {"status": "ok", "environment": settings.ENVIRONMENT}


app.include_router(api_router, prefix=settings.API_V1_PREFIX)
