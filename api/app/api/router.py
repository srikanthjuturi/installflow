"""Aggregate API router — includes every feature slice's router under /api/v1.

This is the one place that imports slice routers (slices never import each
other), keeping the dependency graph acyclic.
"""

from fastapi import APIRouter

from app.features.auth.router import router as auth_router
from app.features.companies.router import router as companies_router
from app.features.geo.router import router as geo_router
from app.features.jobs.router import router as jobs_router
from app.features.jobs.ws import router as jobs_stream_router
from app.features.masters.router import router as masters_router
from app.features.notifications.router import router as notifications_router
from app.features.onboarding.router import router as onboarding_router
from app.features.rbac.router import router as rbac_router
from app.features.search.router import router as search_router
from app.features.technicians.router import router as technicians_router
from app.features.tickets.router import router as tickets_router
from app.features.tickets.ws import router as tickets_stream_router
from app.features.territory.router import router as territory_router
from app.features.uploads.router import router as uploads_router
from app.features.users.router import router as users_router
from app.features.vendor_users.router import router as vendor_users_router
from app.features.vendors.router import router as vendors_router

api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(companies_router)
api_router.include_router(users_router)
api_router.include_router(rbac_router)
api_router.include_router(territory_router)
# The geography master behind territory: what India is, rather than who covers
# which part of it.
api_router.include_router(geo_router)
api_router.include_router(vendors_router)
# Before /vendors is irrelevant — different prefix — but grouped with it so the
# vendor surface reads as one thing.
api_router.include_router(vendor_users_router)
api_router.include_router(masters_router)
api_router.include_router(technicians_router)
api_router.include_router(tickets_router)
# The console's live half: one frame per ticket movement, scoped exactly as the
# REST reads are — staff by territory, a vendor by ownership.
api_router.include_router(tickets_stream_router)
# The same rows as /tickets, seen from the field: scoped by a technician's own
# coverage rather than by territory, and masked until they accept.
api_router.include_router(jobs_router)
# The live half of the same slice: a websocket that tells a technician the
# pool changed, so the app stops discovering it on a twenty-second timer.
api_router.include_router(jobs_stream_router)
api_router.include_router(onboarding_router)
api_router.include_router(uploads_router)
# The bell. Audience is territory, the same rule that scopes tickets — there is
# no feature key, because a manager must not be unable to hear about an
# escalation in their own area for want of a permission grant.
api_router.include_router(notifications_router)
# The topbar box. Reads across five slices at once, so it owns none of them —
# every statement it builds re-applies that entity's own list predicates, and
# staff-only at the door keeps a vendor's ownership rule out of it entirely.
api_router.include_router(search_router)
