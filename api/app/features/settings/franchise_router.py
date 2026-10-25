"""The franchisee admin's own door on the travel-allowance rules (10 §4.8) and
on the speed-allowance matrix (Task 11 §4.10).

The `/franchise` twin of `PUT /settings/travel` — same two rows, same shapes,
but scoped to `principal.franchisee_id` and never a path id: this admin runs
their OWN franchisee, so there is nothing to guess and nothing to pass.

Task 11 adds the same door for the speed matrix: a franchisee admin writes their
own matrix rows (`GET` / `PUT` / `DELETE /settings/speed`), previews the
resolution the stamper will run (`/settings/speed/effective`), and reads the
two pickers (`/settings/speed/catalogue`, price-free — W16). Nothing is
registered in `app/api/router.py` — this router IS the `/franchise` prefix and
it is already mounted; the STAFF twin lives in `app/features/franchisees`,
which imports this module's shapes from `core.speed_rules` and never this
router (slices never import each other).
"""

import uuid

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import Principal, require_all, require_feature, require_franchise_principal
from app.core.schemas import ApiEnvelope, envelope
from app.core.speed_rules import (
    SpeedCatalogueOut,
    SpeedEffectiveOut,
    SpeedRuleIn,
    SpeedRuleOut,
)
from app.core.travel_rules import TravelRulesIn, TravelRulesOut
from app.features.settings import service

router = APIRouter(prefix="/franchise", tags=["franchise"])

Db = Annotated[AsyncSession, Depends(get_db)]
#: The franchisee admin edits their OWN numbers. The feature key is a second
#: gate, not the owner — `require_franchise_principal` is the role test the
#: money wall rests on, as every twin here does.
FranchiseSettings = Annotated[
    Principal,
    Depends(
        require_all(
            require_franchise_principal,
            require_feature("franchise.settings"),
        )
    ),
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


# ── Task 11: the speed-allowance matrix (§4.10) ─────────────────────────────


@router.get("/settings/speed", response_model=ApiEnvelope[list[SpeedRuleOut]])
async def get_speed_rules(
    db: Db,
    principal: FranchiseSettings,
    technicianType: Annotated[str | None, Query()] = None,
) -> ApiEnvelope[list[SpeedRuleOut]]:
    """The whole matrix (or `?technicianType=employee|freelancer`'s half), each
    row with the names and the two inheritance hints the console renders."""
    return envelope(
        await service.get_speed_rules(
            db, principal.company_id, principal.franchisee_id, technicianType
        )
    )


@router.put("/settings/speed", response_model=ApiEnvelope[SpeedRuleOut])
async def put_speed_rule(
    body: SpeedRuleIn, principal: FranchiseSettings, db: Db
) -> ApiEnvelope[SpeedRuleOut]:
    """Save one row of the matrix, upserting on its natural key.

    A rule change affects ONLY jobs accepted after it (S5): every job already
    accepted carries its own frozen copy of the terms in `accept_snapshot`, so
    editing or deleting a row restates nothing.
    """
    return envelope(
        await service.update_speed_rule(
            db, principal, principal.company_id, principal.franchisee_id, body
        ),
        message="Speed rule saved",
    )


@router.delete("/settings/speed/{ruleId}")
async def delete_speed_rule(
    ruleId: uuid.UUID, principal: FranchiseSettings, db: Db
) -> ApiEnvelope[dict]:
    """Remove one row. A node row's removal restores inheritance to what is
    beneath it, which is why there is no soft delete in the matrix."""
    await service.remove_speed_rule(
        db, principal.company_id, principal.franchisee_id, ruleId
    )
    return envelope({"deleted": True}, message="Speed rule removed")


@router.get(
    "/settings/speed/effective", response_model=ApiEnvelope[SpeedEffectiveOut]
)
async def get_effective_speed_rule(
    db: Db,
    principal: FranchiseSettings,
    technicianType: Annotated[str, Query()],
    modelId: Annotated[uuid.UUID | None, Query()] = None,
    nodeId: Annotated[uuid.UUID | None, Query()] = None,
) -> ApiEnvelope[SpeedEffectiveOut]:
    """"What would a job for this product/category pay?" — the preview.

    Exactly one of `modelId` / `nodeId` is accepted, the same question the
    stamper is asked at accept, resolved by the same rule — so the preview and
    the stamp share one answer by construction, never by luck (§4.2, S2).
    """
    return envelope(
        await service.get_effective_speed_rule(
            db, principal.company_id, principal.franchisee_id,
            technician_type=technicianType, model_id=modelId, node_id=nodeId,
        )
    )


@router.get(
    "/settings/speed/catalogue", response_model=ApiEnvelope[SpeedCatalogueOut]
)
async def get_speed_catalogue(
    db: Db, principal: FranchiseSettings
) -> ApiEnvelope[SpeedCatalogueOut]:
    """The rule editor's two pickers in one response — price-free (W16)."""
    return envelope(await service.get_speed_catalogue(db, principal.company_id))