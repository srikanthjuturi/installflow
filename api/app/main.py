"""FastAPI application factory."""

import asyncio
import sys
import warnings
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.router import api_router
from app.core.scheduler import ticker
from app.features.tickets.sweeps import (
    sweep_force_close,
    sweep_silent_slots,
    sweep_slot_reminders,
    sweep_unaccepted,
)
from app.features.technicians.sweeps import sweep_expired_invites
from app.features.onboarding.landing import router as invite_landing_router
from app.features.tickets.feedback_page import router as feedback_page_router
from app.features.tickets.slot_page import router as slot_page_router
from app.features.onboarding.well_known import router as well_known_router
from app.core.config import settings
from app.core.database import engine
from app.core.errors import register_exception_handlers
from app.core.notification_relay import relay
from app.core.realtime import broker

# psycopg's async driver cannot run on Windows' default ProactorEventLoop.
# Select the SelectorEventLoop before any loop is created (import time). NB: for
# the reloading `uvicorn` server the policy must be set even earlier — see run.py.
if sys.platform == "win32":
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


def _check_production_settings() -> None:
    """Refuse to boot with development-only settings in production.

    The bar for being on this list is narrow and worth keeping narrow: each of
    these is silent in every log and in every response, so startup is the only
    moment it can be caught.

    OTP_DEV_ECHO returns the code in the response body. An empty OTP_PEPPER
    leaves a 6-digit code stored as a bare sha256, which a database dump
    reverses by brute force in under a second. And a localhost CONSOLE_LINK_BASE
    sends perfectly — Azure accepts the mail, the recipient gets it, and the
    "Sign in" button resolves to their own machine.

    Deliberately NOT here: the ACS credentials. An unconfigured mailer is loud —
    every account created answers `emailStatus: "failed"` on screen with the
    reason — so it does not meet the bar, and taking the whole API down for it
    would be the wrong trade. `scripts/publish.py` guards those instead.
    """
    if settings.ENVIRONMENT != "production":
        return
    problems = []
    if settings.OTP_DEV_ECHO:
        problems.append("OTP_DEV_ECHO must be false")
    if not settings.OTP_PEPPER:
        problems.append("OTP_PEPPER must be set")
    if settings.CONSOLE_LINK_BASE.startswith("http://localhost"):
        problems.append(
            "CONSOLE_LINK_BASE must be the public console origin — the sign-in "
            "button in every emailed password points at it, and a localhost one "
            "sends fine and arrives dead"
        )
    if problems:
        raise RuntimeError("Unsafe production configuration: " + "; ".join(problems))


@asynccontextmanager
async def lifespan(app: FastAPI):
    _check_production_settings()
    # Verify DB connectivity on startup — fail fast if unreachable.
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    # The LISTEN connection behind the technician's live pool. Started after
    # the connectivity check so a database that is down fails as a startup
    # error rather than as a listener quietly retrying in the background.
    await broker.start()
    # Web push to the console, driven off that same broker. After the broker so
    # it has something to subscribe to; it is a no-op when WEB_PUSH_ENABLED is
    # off or the VAPID pair is missing.
    await relay.start()
    # The time-based notifications. Registered here rather than in `core`
    # because the sweeps are ticket-domain queries and core must not import a
    # slice — main.py is already the composition root that imports every one.
    ticker.register("escalation", sweep_unaccepted)
    ticker.register("slot-silence", sweep_silent_slots)
    ticker.register("force-close", sweep_force_close)
    ticker.register("slot-reminder", sweep_slot_reminders)
    # Not a ticket: an invite that lapsed with nobody registering against it.
    # Same reason it is registered here — the sweep is a technicians-domain
    # query and core must not import a slice.
    ticker.register("invite-expiry", sweep_expired_invites)
    await ticker.start()
    yield
    await ticker.stop()
    # Before the broker: the relay is one of its subscribers, and stopping the
    # thing it reads from first would leave it awaiting a mailbox nobody fills.
    await relay.stop()
    await broker.stop()
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

# NOT under /api/v1 — this is the page a technician's browser lands on when
# they tap the invite link, so the URL has to stay short and human.
app.include_router(invite_landing_router)

# Also outside /api/v1: the page a CUSTOMER lands on to pick their appointment
# time. Same reasoning as the invite link — it arrives over WhatsApp and gets
# tapped on a phone, so the URL stays short. It is the one unauthenticated
# write in the app; see the module docstring for what makes that safe.
app.include_router(slot_page_router)

# The second unauthenticated customer page, and the one that CLOSES a job: the
# technician says the work is done, this is where the customer agrees. Outside
# /api/v1 for the same reason as the slot page — it arrives over WhatsApp and
# gets tapped on a phone.
app.include_router(feedback_page_router)

# Also outside /api/v1, and the path is fixed by Android — it fetches exactly
# https://<host>/.well-known/assetlinks.json and nothing else.
app.include_router(well_known_router)
