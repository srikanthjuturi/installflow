"""Aggregate API router — includes every feature slice's router under /api/v1.

This is the one place that imports slice routers (slices never import each
other), keeping the dependency graph acyclic.
"""

from fastapi import APIRouter

from app.features.auth.router import router as auth_router
from app.features.companies.router import router as companies_router
from app.features.rbac.router import router as rbac_router
from app.features.users.router import router as users_router

api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(companies_router)
api_router.include_router(users_router)
api_router.include_router(rbac_router)
