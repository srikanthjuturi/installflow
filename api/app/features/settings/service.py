"""Read and replace operating rules — for the company, and per catalogue node.

What earns this a module is the conversion boundary: rupees on the wire, paise
in storage (hard rule 9), done here and nowhere else so no caller has to
remember which side it is on.

## Two scopes, one set of invariants

`company_rules` is the baseline; `product_node_rules` holds a node's overrides,
and `core.rules.resolve_rules` folds the chain. Neither writer can check the
cross-field invariants on what it was handed — a node overriding
`slot_silence_hours` alone can invert an escalation window it never mentioned,
and the company's own row can invalidate a node's overrides from above.

So **both writers validate the RESOLVED sets**, through `_assert_consistent`.
It checks the company baseline plus every node carrying an override row, which
is exactly the set of distinct outcomes: a node with nothing in its chain
resolves to the company set, and a node inheriting from an ancestor resolves to
that ancestor's set, both of which are already in the list.
"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Principal
from app.core.rules import (
    CANCEL_PENALTY_BANDS,
    LIMITS,
    load_rules,
    resolve_rules,
    resolve_rules_with_sources,
    validate_resolved,
)
from app.features.settings.schemas import (
    NodeRulesOut,
    NodeRulesUpdateRequest,
    NodeRuleValues,
    PenaltyBandOut,
    RulesOut,
    RulesUpdateRequest,
)
from app.models.company_rules import CompanyRules
from app.models.product import ProductNode
from app.models.product_node_rules import ProductNodeRules

#: Wire name → the `core.rules` key it sets. One mapping, read in both
#: directions, so a field cannot be written under one name and read under
#: another. `penaltyCap` is absent because a node may not override it.
NODE_FIELDS: dict[str, str] = {
    "penalty": "cancel_penalties_paise",
    "bonusAmounts": "bonus_bands_paise",
    "aiThreshold": "ai_confidence_threshold",
    "slaWarnAtPct": "sla_warn_at_pct",
    "slotConfirmTimeoutHours": "slot_silence_hours",
    "escalationTriggerHours": "escalate_hours_before_slot",
    "customerWaitHours": "force_close_hours",
    "renotifyGraceMinutes": "renotify_grace_minutes",
    "slotReminderMinutes": "slot_reminder_minutes",
    "customerNoticeMinutes": "customer_notice_minutes",
    "geoRadiusM": "geo_radius_m",
}

#: The two that are lists of rupee amounts rather than a single number.
MONEY_LISTS = frozenset({"cancel_penalties_paise", "bonus_bands_paise"})


def _to_rupees(paise: int) -> int:
    """Whole rupees. Every stored figure is a whole-rupee amount times 100 —
    `PUT` only accepts integers — so this never truncates anything real."""
    return paise // 100


def _out(rules: CompanyRules) -> RulesOut:
    ai_min, ai_max = LIMITS["ai_confidence_threshold"]
    return RulesOut(
        penalty=[
            PenaltyBandOut(band=band, amount=_to_rupees(paise))
            # zip, not an index: the label list is the authority on how many
            # bands there are, and the CHECK on the column already guarantees
            # the stored array matches its length.
            for band, paise in zip(CANCEL_PENALTY_BANDS, rules.cancel_penalties_paise)
        ],
        penaltyCap=_to_rupees(rules.cancel_penalty_cap_paise),
        bonusAmounts=[_to_rupees(p) for p in rules.bonus_bands_paise],
        aiThreshold=rules.ai_confidence_threshold,
        aiThresholdMin=ai_min,
        aiThresholdMax=ai_max,
        slaWarnAtPct=rules.sla_warn_at_pct,
        slotConfirmTimeoutHours=rules.slot_silence_hours,
        escalationTriggerHours=rules.escalate_hours_before_slot,
        customerWaitHours=rules.force_close_hours,
        renotifyGraceMinutes=rules.renotify_grace_minutes,
        slotReminderMinutes=rules.slot_reminder_minutes,
        customerNoticeMinutes=rules.customer_notice_minutes,
        geoRadiusM=rules.geo_radius_m,
    )


async def get_rules(db: AsyncSession, company_id: uuid.UUID) -> RulesOut:
    return _out(await load_rules(db, company_id))


async def update_rules(
    db: AsyncSession, principal: Principal, body: RulesUpdateRequest
) -> RulesOut:
    """Replace the whole row and answer with what is now stored.

    Answers from the row rather than echoing the request: the response is what
    the next reader will get, and a screen that re-seeds its form from an echo
    would not notice a value the database had adjusted or refused.
    """
    rules = await load_rules(db, principal.company_id)

    # A NEW list each time — SQLAlchemy does not track JSONB mutation in place,
    # so appending to or indexing into the existing list saves nothing.
    rules.cancel_penalties_paise = [amount * 100 for amount in body.penalty]
    rules.cancel_penalty_cap_paise = body.penaltyCap * 100
    rules.bonus_bands_paise = [amount * 100 for amount in body.bonusAmounts]

    rules.ai_confidence_threshold = body.aiThreshold
    rules.sla_warn_at_pct = body.slaWarnAtPct
    rules.slot_silence_hours = body.slotConfirmTimeoutHours
    rules.escalate_hours_before_slot = body.escalationTriggerHours
    rules.force_close_hours = body.customerWaitHours
    rules.renotify_grace_minutes = body.renotifyGraceMinutes
    rules.slot_reminder_minutes = body.slotReminderMinutes
    rules.customer_notice_minutes = body.customerNoticeMinutes
    rules.geo_radius_m = body.geoRadiusM
    rules.updated_by = principal.user_id

    # Every node's overrides sit ON TOP of this row, so lowering the company's
    # slot-confirm timeout can invalidate a category that only ever set its
    # escalation trigger. Checked before the commit, naming the category, so the
    # manager is told which one rather than discovering it when a sweep
    # misbehaves.
    await _assert_consistent(db, principal.company_id)

    # `get_db` yields a session and closes it; it does NOT commit. Every write
    # in this codebase commits for itself, and a flush alone would answer with
    # the new values and then roll them back on the way out — which is exactly
    # what the first end-to-end run of this endpoint did.
    await db.commit()
    return _out(rules)


# ── per-category overrides ────────────────────────────────────────────────────


def _bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


async def _load_node(
    db: AsyncSession, company_id: uuid.UUID, node_id: uuid.UUID
) -> ProductNode:
    """A live node of the caller's own company, or 404.

    Queries the model directly rather than calling the masters service — hard
    rule 4 forbids one slice importing another's service, while sharing models
    is normal.
    """
    row = await db.scalar(
        select(ProductNode).where(
            ProductNode.id == node_id,
            ProductNode.company_id == company_id,
            ProductNode.deleted_at.is_(None),
        )
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Category not found"
        )
    return row


async def _assert_consistent(db: AsyncSession, company_id: uuid.UUID) -> None:
    """Every reachable resolved set still holds together, or 400 naming the node.

    Flushes first, so it validates what is about to be committed rather than
    what was there before. It does NOT commit and does NOT roll back: raising
    inside the request leaves `get_db` to discard the session, which is how
    every other refusal in this codebase behaves.

    Only nodes with their OWN override row are resolved. That is not a shortcut
    — see the module docstring — and it bounds the work by how many categories
    somebody has actually configured rather than by the size of the catalogue.
    """
    await db.flush()

    problem = validate_resolved(dict(await _company_values(db, company_id)))
    if problem:
        raise _bad_request(problem)

    rows = (
        await db.execute(
            select(ProductNodeRules.node_id, ProductNode.name)
            .join(ProductNode, ProductNode.id == ProductNodeRules.node_id)
            .where(
                ProductNodeRules.company_id == company_id,
                ProductNode.deleted_at.is_(None),
            )
        )
    ).all()
    for node_id, name in rows:
        problem = validate_resolved(await resolve_rules(db, company_id, node_id))
        if problem:
            raise _bad_request(f"{name}: {problem}")


async def _company_values(db: AsyncSession, company_id: uuid.UUID) -> dict:
    """The company baseline as a plain dict, in `core.rules` keys."""
    from app.core.rules import DEFAULTS, RULE_KEYS

    row = await load_rules(db, company_id)
    values = dict(DEFAULTS)
    for key in RULE_KEYS:
        current = getattr(row, key, None)
        if current is not None:
            values[key] = current
    return values


def _own_values(row: ProductNodeRules | None) -> NodeRuleValues:
    """A node's stored overrides, back on the wire in rupees."""
    if row is None:
        return NodeRuleValues()
    fields: dict = {}
    for wire, key in NODE_FIELDS.items():
        stored = getattr(row, key)
        if stored is None:
            fields[wire] = None
        elif key in MONEY_LISTS:
            fields[wire] = [_to_rupees(p) for p in stored]
        else:
            # Everything else is already a count, a percentage or metres — the
            # only money a node may override is the two lists, because
            # `penaltyCap` is company-wide.
            fields[wire] = stored
    return NodeRuleValues(**fields)


def _effective_out(resolved: dict) -> RulesOut:
    """The resolved dict in the same shape `GET /settings/rules` answers with."""
    ai_min, ai_max = LIMITS["ai_confidence_threshold"]
    return RulesOut(
        penalty=[
            PenaltyBandOut(band=band, amount=_to_rupees(paise))
            for band, paise in zip(
                CANCEL_PENALTY_BANDS, resolved["cancel_penalties_paise"]
            )
        ],
        penaltyCap=_to_rupees(resolved["cancel_penalty_cap_paise"]),
        bonusAmounts=[_to_rupees(p) for p in resolved["bonus_bands_paise"]],
        aiThreshold=resolved["ai_confidence_threshold"],
        aiThresholdMin=ai_min,
        aiThresholdMax=ai_max,
        slaWarnAtPct=resolved["sla_warn_at_pct"],
        slotConfirmTimeoutHours=resolved["slot_silence_hours"],
        escalationTriggerHours=resolved["escalate_hours_before_slot"],
        customerWaitHours=resolved["force_close_hours"],
        renotifyGraceMinutes=resolved["renotify_grace_minutes"],
        slotReminderMinutes=resolved["slot_reminder_minutes"],
        customerNoticeMinutes=resolved["customer_notice_minutes"],
        geoRadiusM=resolved["geo_radius_m"],
    )


async def _node_out(
    db: AsyncSession, company_id: uuid.UUID, node: ProductNode
) -> NodeRulesOut:
    own = await db.scalar(
        select(ProductNodeRules).where(
            ProductNodeRules.company_id == company_id,
            ProductNodeRules.node_id == node.id,
        )
    )
    resolved, sources = await resolve_rules_with_sources(db, company_id, node.id)

    names = {node.id: node.name}
    if node.ancestor_ids:
        names.update(
            {
                row_id: row_name
                for row_id, row_name in await db.execute(
                    select(ProductNode.id, ProductNode.name).where(
                        ProductNode.id.in_(list(node.ancestor_ids))
                    )
                )
            }
        )
    path = [names.get(n, "") for n in (*node.ancestor_ids, node.id)]

    return NodeRulesOut(
        nodeId=node.id,
        path=[name for name in path if name],
        own=_own_values(own),
        effective=_effective_out(resolved),
        # Only what an ANCESTOR supplied. A value this node set itself is
        # already visible in `own`, and labelling it "from Android TV" on the
        # Android TV screen would read as inheritance from itself.
        inheritedFrom={
            wire: sources[key]
            for wire, key in NODE_FIELDS.items()
            if sources.get(key) and sources[key] != node.name
        },
    )


async def get_node_rules(
    db: AsyncSession, principal: Principal, node_id: uuid.UUID
) -> NodeRulesOut:
    node = await _load_node(db, principal.company_id, node_id)
    return await _node_out(db, principal.company_id, node)


async def update_node_rules(
    db: AsyncSession,
    principal: Principal,
    node_id: uuid.UUID,
    body: NodeRulesUpdateRequest,
) -> NodeRulesOut:
    """Replace this node's overrides. A body of all nulls deletes the row.

    Deleting rather than storing eleven nulls keeps "does this node override
    anything" a row-exists question — which is what the tree's badge and
    `_assert_consistent`'s work list both ask.
    """
    node = await _load_node(db, principal.company_id, node_id)
    row = await db.scalar(
        select(ProductNodeRules).where(
            ProductNodeRules.company_id == principal.company_id,
            ProductNodeRules.node_id == node_id,
        )
    )

    values: dict = {}
    for wire, key in NODE_FIELDS.items():
        given = getattr(body, wire)
        if given is None:
            values[key] = None
        elif key in MONEY_LISTS:
            values[key] = [amount * 100 for amount in given]
        else:
            values[key] = given

    if all(value is None for value in values.values()):
        if row is not None:
            await db.delete(row)
        await _assert_consistent(db, principal.company_id)
        await db.commit()
        return await _node_out(db, principal.company_id, node)

    if row is None:
        row = ProductNodeRules(
            company_id=principal.company_id,
            node_id=node_id,
            created_by=principal.user_id,
        )
        db.add(row)
    for key, value in values.items():
        setattr(row, key, value)
    row.updated_by = principal.user_id

    await _assert_consistent(db, principal.company_id)
    await db.commit()
    return await _node_out(db, principal.company_id, node)


async def clear_node_rules(
    db: AsyncSession, principal: Principal, node_id: uuid.UUID
) -> NodeRulesOut:
    """Reset this node to inheriting everything.

    ⚠ **Removing an override can break a DESCENDANT**, which is why this
    validates rather than just deleting. A node's override is what makes a
    deeper node's override legal: set the confirmation timeout to 24h on
    *Television* and the escalation trigger to 10h on a leaf below it, and both
    are fine — take the 24h away and the leaf is left escalating 10h before a
    slot the customer only had 6h to confirm, which is exactly what
    `validate_resolved` exists to prevent.

    Nothing downstream can repair that. A ticket raised afterwards stamps the
    broken pair into `rules_snapshot` permanently, by design.

    This is the same user action as `update_node_rules` with an all-null body —
    the console's *Reset to inherited* — and that branch has always validated.
    Two paths to one outcome, and only one of them checked; the DELETE is the
    one the button actually takes.
    """
    node = await _load_node(db, principal.company_id, node_id)
    row = await db.scalar(
        select(ProductNodeRules).where(
            ProductNodeRules.company_id == principal.company_id,
            ProductNodeRules.node_id == node_id,
        )
    )
    if row is not None:
        await db.delete(row)
        # `_assert_consistent` flushes first, so it sees the row as gone —
        # sessions run with `autoflush=False` and would otherwise validate the
        # state this call is removing.
        await _assert_consistent(db, principal.company_id)
        await db.commit()
    return await _node_out(db, principal.company_id, node)
