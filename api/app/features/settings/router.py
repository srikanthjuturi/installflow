"""Rules configuration: the numbers this company operates by.

Two keys, not one. `settings.view` opens the screen; `settings.edit` changes
what the sweeps and the pool actually do. They were the same grant until this
slice existed, which was harmless only because Save wrote to a JavaScript
object — the moment it writes to a table, "can see the escalation window" and
"can move it" stop being the same question.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import Principal, require_any_feature, require_feature
from app.core.schemas import ApiEnvelope, envelope
from app.features.settings import service
from app.features.settings.schemas import (
    NodeRulesOut,
    NodeRulesUpdateRequest,
    RulesOut,
    RulesUpdateRequest,
)

router = APIRouter(prefix="/settings", tags=["settings"])

Db = Annotated[AsyncSession, Depends(get_db)]
#: Reading the numbers is not opening the screen that sets them.
#:
#: `settings.view` is the Rules configuration screen. `jobs.assign` is the
#: escalation queue, which SPENDS one of these numbers: the bonus bands are
#: what the re-notification screen offers a manager to choose between. An Area
#: Manager holds the second and not the first, deliberately — and gated on
#: `settings.view` alone, the one role §7 puts escalations in front of could
#: not read the four amounts it is being asked to pick from.
ReadRules = Annotated[
    Principal, Depends(require_any_feature("settings.view", "jobs.assign"))
]
EditSettings = Annotated[Principal, Depends(require_feature("settings.edit"))]


@router.get("/rules", response_model=ApiEnvelope[RulesOut])
async def get_rules(principal: ReadRules, db: Db) -> ApiEnvelope[RulesOut]:
    """Every number this company operates by.

    Read by more than the screen that edits it — see `ReadRules`. The WRITE
    below stays on the single `settings.edit` key, which is the split this
    slice was created to make.
    """
    return envelope(await service.get_rules(db, principal.company_id))


@router.put("/rules", response_model=ApiEnvelope[RulesOut])
async def update_rules(
    body: RulesUpdateRequest, principal: EditSettings, db: Db
) -> ApiEnvelope[RulesOut]:
    return envelope(
        await service.update_rules(db, principal, body),
        message="Rules configuration saved",
    )


@router.get("/rules/nodes/{node_id}", response_model=ApiEnvelope[NodeRulesOut])
async def get_node_rules(
    node_id: uuid.UUID, principal: ReadRules, db: Db
) -> ApiEnvelope[NodeRulesOut]:
    """One category's overrides, what it resolves to, and where each came from.

    Three things rather than one, because the screen needs all three at once:
    the boxes bind to `own`, the placeholders come from `effective`, and the
    "from *TV*" hint beside each comes from `inheritedFrom`.
    """
    return envelope(await service.get_node_rules(db, principal, node_id))


@router.put("/rules/nodes/{node_id}", response_model=ApiEnvelope[NodeRulesOut])
async def update_node_rules(
    node_id: uuid.UUID,
    body: NodeRulesUpdateRequest,
    principal: EditSettings,
    db: Db,
) -> ApiEnvelope[NodeRulesOut]:
    """Replace this category's overrides. Null anywhere means inherit."""
    return envelope(
        await service.update_node_rules(db, principal, node_id, body),
        message="Category rules saved",
    )


@router.delete("/rules/nodes/{node_id}", response_model=ApiEnvelope[NodeRulesOut])
async def clear_node_rules(
    node_id: uuid.UUID, principal: EditSettings, db: Db
) -> ApiEnvelope[NodeRulesOut]:
    """Drop every override, so this category inherits everything again."""
    return envelope(
        await service.clear_node_rules(db, principal, node_id),
        message="Category rules reset",
    )
