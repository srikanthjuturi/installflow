"""Aggregate API router — includes every feature slice's router under /api/v1.

This is the one place that imports slice routers (slices never import each
other), keeping the dependency graph acyclic.
"""

from fastapi import APIRouter

from app.features.auth.router import router as auth_router
from app.features.companies.router import router as companies_router
from app.features.masters.router import router as masters_router
from app.features.onboarding.router import router as onboarding_router
from app.features.rbac.router import router as rbac_router
from app.features.technicians.router import router as technicians_router
from app.features.tickets.router import router as tickets_router
from app.features.territory.router import router as territory_router
from app.features.uploads.router import router as uploads_router
from app.features.users.router import router as users_router
from app.features.vendors.router import router as vendors_router

api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(companies_router)
api_router.include_router(users_router)
api_router.include_router(rbac_router)
api_router.include_router(territory_router)
api_router.include_router(vendors_router)
api_router.include_router(masters_router)
api_router.include_router(technicians_router)
api_router.include_router(tickets_router)
api_router.include_router(onboarding_router)
api_router.include_router(uploads_router)
