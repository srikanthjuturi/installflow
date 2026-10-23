"""The franchisee admin's own door on the travel-allowance rules (10 §4.8).

The `/franchise` twin of `PUT /settings/travel` — same two rows, same shapes,
but scoped to `principal.franchisee_id` and never a path id: this admin runs
their OWN franchisee, so there is nothing to guess and nothing to pass.
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import Principal, require_feature, require_franchise_principal
from app.core.schemas import ApiEnvelope, envelope
from app.core.travel_rules import TravelRulesIn, TravelRulesOut
from app.features.settings import service

router = APIRouter(prefix="/franchise", tags=["franchise"])

Db = Annotated[AsyncSession, Depends(get_db)]
#: The franchisee admin edits their OWN numbers. The feature key is a second
#: gate, not the owner — `require_franchise_principal` is the role test the
#: money wall rests on, as every twin here does.
FranchiseSettings = Annotated[
    Principal,
    Depends(require_franchise_principal),
    Depends(require_feature("franchise.settings")),
]


@router.get(
    "/settings/travel", response_model=ApiEnvelope[TravelRulesOut]
)
async def get_travel_settings(
    principal: FranchiseSettings, db: Db
) -> ApiEnvelope[TravelRulesOut]:
    """Both types' allowance rules for this franchisee — the form's seed."""
    return envelope(
        await service.get_travel(db, principal.company_id, principal.franchisee_id)
    )


@router.put(
    "/settings/travel", response_model=ApiEnvelope[TravelRulesOut]
)
async def put_travel_settings(
    body: TravelRulesIn, principal: FranchiseSettings, db: Db
) -> ApiEnvelope[TravelRulesOut]:
    """Save both types' allowance rules.

    A rule change affects ONLY jobs accepted after it (TA5): every job already
    accepted carries its own frozen copy in `accept_snapshot`, and nothing
    downstream reads these rows again — so a cheaper rule never restates a job
    that was accepted under the expensive one.
    """
    return envelope(
        await service.update_travel(
            db, principal, principal.company_id, principal.franchisee_id, body
        ),
        message="Travel settings saved",
    )