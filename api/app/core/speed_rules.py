"""Where the speed allowance's per-franchisee matrix is stored, edited, resolved.

Task 11 (S1, S2). Shapes itself on `core/travel_rules.py`, Task 10's sibling:
the writes flush and never commit — the caller (a router's service or the
stamper) owns the transaction — and every query is company-scoped first.

Three differences from the travel table, all Task 11's own:

  * Not two rows per franchisee but a MATRIX — one row per (franchisee,
    technician type, node) or (franchisee, technician type, model). The two
    partial uniques are the upsert's arbiter, so a double-click is two writes
    of one row rather than a 409.
  * Resolution never self-heals: an EMPTY matrix means OFF (W1). Unlike a
    travel rule there is no default set — absence is the answer, and
    `resolve_terms` returning None stamps `speed: None` and measures nothing.
  * The list carries inheritance HINTS (`overridesRuleId` / `overriddenBy`)
    computed in Python over the whole matrix, so the console shows what a row
    beats and what still beats it without a recursive query per row.

Resolution ignores soft-deletion on purpose: a rule matters for tickets already
raised against a node later removed, and the list's `targetActive` is how the
console greys such rows.

A rule change affects only jobs accepted after it (S5): nothing here touches a
snapshot already stamped, and the one outside reader of the matrix is
`core.accept_snapshot.build_accept_snapshot`, through `resolve_terms`. Slices
never import each other (hard rule 4) — the routers for both consoles sit over
THIS module, and neither imports the other.
"""

import datetime
import uuid

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Literal, Sequence

from app.core.errors import AppError
from app.core.product_tree import APPROVED
from app.core.schemas import AppModel
from app.core.speed import SpeedTerms, resolve_speed_rule
from app.models.franchisee_speed_rule import FranchiseeSpeedRule
from app.models.product import ProductModel, ProductNode
from app.models.technician import TECHNICIAN_TYPES
from app.models.vendor_brand import VendorBrand

_TECH_TYPES = tuple(TECHNICIAN_TYPES)

#: The wire name for a target the catalogue no longer holds — soft-deleted rows
#: still resolve (see above), but an id that is gone outright has lost its name
#: with it. The rule remains; only the display reads as absent.
_GONE = "—"

assert set(_TECH_TYPES) == {"employee", "freelancer"}, (
    "The matrix is per technician type, and there are exactly two"
)


# ── wire shapes ──────────────────────────────────────────────────────────────


class SpeedRuleIn(AppModel):
    """The PUT body — one row of the matrix. Every bound repeats a CHECK on
    `franchisee_speed_rules`, so what the schema accepts the table takes; the
    bounds are mirrored rather than imported so the Field bounds on the wire
    read plainly (Task 10's convention)."""

    technicianType: Literal["employee", "freelancer"]   # §4.2's table, verbatim
    nodeId: uuid.UUID | None = None
    modelId: uuid.UUID | None = None
    rewardWithinHours: int = Field(ge=1, le=720)
    penaltyAfterHours: int = Field(ge=1, le=720)
    rewardPaise: int = Field(ge=0, le=1_000_000, multiple_of=100)
    penaltyPaise: int = Field(ge=0, le=1_000_000, multiple_of=100)

    @model_validator(mode="after")
    def _one_target_and_sane_bands(self):
        # Exactly one target — the table's `one_target` CHECK, said in words.
        if (self.nodeId is None) == (self.modelId is None):
            raise ValueError("Pick a category or a product, not both")
        # W2 allows either amount to be ₹0; what it forbids is the bands' ends
        # crossing. The message names both figures — a console pasting the
        # error into a bug report is the only reader it will ever have.
        if self.penaltyAfterHours < self.rewardWithinHours:
            raise ValueError(
                f"Penalty after {self.penaltyAfterHours} h cannot come before the "
                f"reward within {self.rewardWithinHours} h — raise rewardWithinHours "
                "or lower penaltyAfterHours"
            )
        return self


class SpeedRuleOut(AppModel):
    """One matrix row with the names a console renders it from, and the two
    inheritance hints computed over the whole matrix in `list_rules`."""

    id: uuid.UUID
    technicianType: str
    targetKind: str  # "node" | "model"
    targetId: uuid.UUID
    targetName: str                   # node or model name, "—" if gone
    targetPath: list[str]             # root-first names; a model adds its own
    targetActive: bool                # gone or inactive → false
    rewardWithinHours: int
    penaltyAfterHours: int
    rewardPaise: int
    penaltyPaise: int
    overridesRuleId: uuid.UUID | None  # the nearest shallower row this beats
    overridesName: str | None          # that row's target name
    overriddenBy: int                  # rows of the same type beneath this node
    updatedAt: datetime.datetime


class SpeedEffectiveOut(AppModel):
    """The console's preview — the SAME resolution the stamper runs (see
    `resolve_terms`), so the preview and the stamp can never disagree."""

    rule: SpeedRuleOut | None          # null = no speed rule applies
    matchedOn: str | None              # "model" | "node"; Null with the rule


class SpeedCatalogueNodeOut(AppModel):
    id: uuid.UUID
    parentId: uuid.UUID | None
    name: str
    depth: int
    isLeaf: bool
    isActive: bool


class SpeedCatalogueModelOut(AppModel):
    """Approved, non-deleted models only — a rule cannot sit on anything a
    ticket cannot be raised against. No price field and no technician count
    anywhere in this catalogue (W16): a rule editor needs the tree's shape."""

    id: uuid.UUID
    nodeId: uuid.UUID
    name: str
    brandName: str


class SpeedCatalogueOut(AppModel):
    nodes: list[SpeedCatalogueNodeOut]    # non-deleted nodes, any depth
    models: list[SpeedCatalogueModelOut]


# ── the resolution half (S2) ─────────────────────────────────────────────────


async def candidate_rules(
    db: AsyncSession, *, company_id: uuid.UUID, franchisee_id: uuid.UUID,
    technician_type: str, model_id: uuid.UUID | None,
    node_path_ids: Sequence[uuid.UUID] | None,
) -> list[FranchiseeSpeedRule]:
    """The matrix rows that could govern one ticket: this franchisee's rows for
    this technician type whose target is the ticket's model or any node on its
    stamped path. `ix_franchisee_speed_rules_company_franchisee` serves it.

    Soft-deleted targets come back on purpose — the ticket is already raised
    against that node, and S2 rules on what WAS its path, not on what the
    catalogue holds today.
    """
    return list(
        await db.scalars(
            select(FranchiseeSpeedRule).where(
                FranchiseeSpeedRule.company_id == company_id,
                FranchiseeSpeedRule.franchisee_id == franchisee_id,
                FranchiseeSpeedRule.technician_type == technician_type,
                (FranchiseeSpeedRule.model_id == model_id)
                | FranchiseeSpeedRule.node_id.in_(list(node_path_ids or [])),
            )
        )
    )


async def resolve_terms(
    db: AsyncSession, *, company_id: uuid.UUID, franchisee_id: uuid.UUID,
    technician_type: str, model_id: uuid.UUID | None,
    node_path_ids: Sequence[uuid.UUID] | None,
) -> SpeedTerms | None:
    """`build_accept_snapshot`'s stamper — the SQL half of S2 plus its pure
    half in `core.speed.resolve_speed_rule`. The figures are FREEZEN here, at
    accept (S5): a rule edited later restates nothing already stamped.

    None = no rule applies (W1) — which stamps `speed: None` and measures
    nothing at closure. There is no self-heal and no default set; absence is
    the answer.
    """
    candidates = await candidate_rules(
        db, company_id=company_id, franchisee_id=franchisee_id,
        technician_type=technician_type, model_id=model_id,
        node_path_ids=node_path_ids,
    )
    if not candidates:
        return None
    pick = resolve_speed_rule(
        candidates, model_id=model_id, node_path_ids=node_path_ids or [],
    )
    if pick is None:
        return None
    row, matched_on = pick
    return SpeedTerms(
        rule_id=row.id,
        matched_on=matched_on,
        matched_id=row.model_id if matched_on == "model" else row.node_id,
        reward_within_hours=row.reward_within_hours,
        penalty_after_hours=row.penalty_after_hours,
        reward_paise=row.reward_paise,
        penalty_paise=row.penalty_paise,
    )


# ── the CRUD half (S1) ───────────────────────────────────────────────────────


async def list_rules(
    db: AsyncSession, *, company_id: uuid.UUID, franchisee_id: uuid.UUID,
    technician_type: str | None = None,
) -> list[SpeedRuleOut]:
    """The whole matrix (or one type's half), ordered by technician type then
    by target path — root-first names, a model after its node — with the
    inheritance hints computed over the full matrix.

    A franchisee's matrix is a few dozen rows at most (one per target per
    type), so reading it whole and hinting in memory beats a recursive query
    per row, and the hints can see rows the type filter hides.
    """
    rows = list(
        await db.scalars(
            select(FranchiseeSpeedRule).where(
                FranchiseeSpeedRule.company_id == company_id,
                FranchiseeSpeedRule.franchisee_id == franchisee_id,
            )
        )
    )
    shown = (
        rows
        if technician_type is None
        else [r for r in rows if r.technician_type == technician_type]
    )
    outs = await _rule_outs(db, rows, company_id=company_id)   # hints see every row
    _rank = {t: i for i, t in enumerate(_TECH_TYPES)}
    ordered = sorted(
        (outs[r.id] for r in shown if r.id in outs),
        key=lambda o: (
            _rank.get(o.technicianType, 99),
            o.targetPath,                   # root-first names, model after node
            str(o.targetId),                # stable when names tie
        ),
    )
    return ordered


async def effective_rule(
    db: AsyncSession, *, company_id: uuid.UUID, franchisee_id: uuid.UUID,
    technician_type: str, model_id: uuid.UUID | None = None,
    node_id: uuid.UUID | None = None,
) -> SpeedEffectiveOut:
    """"What would a job for this product pay?" — the console's preview.

    Exactly one of `modelId` / `nodeId` is accepted, the same question the
    stamper is asked at accept, resolved by the same rule — so the preview and
    the stamp share one answer by construction, never by luck (S2).
    """
    if (model_id is None) == (node_id is None):
        raise AppError(
            422, "SPEED_TARGET_REQUIRED", "Pick a category or a product, not both"
        )
    node_path_ids: list[uuid.UUID] = []
    if node_id is not None:
        node = await _load_node(db, company_id=company_id, node_id=node_id)
        node_path_ids = [*node.ancestor_ids, node.id]
    else:
        model = await _load_model(db, company_id=company_id, model_id=model_id)
        if model.approval_status != APPROVED:
            raise AppError(
                422, "SPEED_MODEL_NOT_APPROVED",
                "Only an approved product can carry a speed rule",
            )
        # The preview asks the same question the stamper does, so the model's
        # node has to join the path too — a model rule and its node's rule both
        # sit on this path. The node was live when the model was priced; if it
        # has since been deleted the 404 below is the honest answer, the same
        # one `upsert_rule`'s own load gives.
        node = await _load_node(db, company_id=company_id, node_id=model.node_id)
        node_path_ids = [*node.ancestor_ids, node.id]

    terms = await resolve_terms(
        db, company_id=company_id, franchisee_id=franchisee_id,
        technician_type=technician_type, model_id=model_id,
        node_path_ids=node_path_ids,
    )
    if terms is None or terms.rule_id is None:
        return SpeedEffectiveOut(rule=None, matchedOn=None)
    row = await db.scalar(
        select(FranchiseeSpeedRule).where(FranchiseeSpeedRule.id == terms.rule_id)
    )
    # The terms came FROM this row moments ago; absent means raced with a
    # delete, and the honest reply is still "no rule applies" — never a 500.
    if row is None:
        return SpeedEffectiveOut(rule=None, matchedOn=None)
    outs = await _rule_outs(
        db,
        company_id=company_id,
        rows=list(await db.scalars(
            select(FranchiseeSpeedRule).where(
                FranchiseeSpeedRule.company_id == company_id,
                FranchiseeSpeedRule.franchisee_id == franchisee_id,
            )
        ))
    )
    return SpeedEffectiveOut(
        rule=outs.get(row.id), matchedOn=terms.matched_on,
    )


async def upsert_rule(
    db: AsyncSession, *, company_id: uuid.UUID, franchisee_id: uuid.UUID,
    body: SpeedRuleIn, by_user: uuid.UUID,
) -> SpeedRuleOut:
    """Write one row of the matrix, upserting on its natural key — a
    double-click is two writes of one row, not a 409.

    Every validation from §4.2 runs BEFORE the write; the arbiter names the
    partial unique AND repeats its WHERE, which Postgres requires when the
    index is partial (`index_where` carries it). Flushes, does not commit —
    the caller owns the transaction.
    """
    values: dict = {
        "company_id": company_id,
        "franchisee_id": franchisee_id,
        "technician_type": body.technicianType,
        "node_id": None,
        "model_id": None,
    }
    if body.nodeId is not None:
        node = await db.scalar(
            select(ProductNode).where(
                ProductNode.company_id == company_id,
                ProductNode.id == body.nodeId,
                ProductNode.deleted_at.is_(None),
            )
        )
        # Any depth, roots included, inactive allowed — a rule on a paused
        # category still governs tickets raised against it. A guessed id never
        # says it exists (tenancy rule 0).
        if node is None:
            raise AppError(404, "NOT_FOUND", "Category not found")
        values["node_id"] = node.id
    else:
        model = await db.scalar(
            select(ProductModel).where(
                ProductModel.company_id == company_id,
                ProductModel.id == body.modelId,
                ProductModel.deleted_at.is_(None),
            )
        )
        if model is None:
            raise AppError(404, "NOT_FOUND", "Product not found")
        if model.approval_status != APPROVED:
            raise AppError(
                422, "SPEED_MODEL_NOT_APPROVED",
                "Only an approved product can carry a speed rule",
            )
        values["model_id"] = model.id

    is_model = values["model_id"] is not None
    stmt = insert(FranchiseeSpeedRule).values(
        **values,
        reward_within_hours=body.rewardWithinHours,
        penalty_after_hours=body.penaltyAfterHours,
        reward_paise=body.rewardPaise,
        penalty_paise=body.penaltyPaise,
        created_by=by_user,
        updated_by=by_user,
    )
    if is_model:
        stmt = stmt.on_conflict_do_update(
            index_elements=[
                FranchiseeSpeedRule.company_id,
                FranchiseeSpeedRule.franchisee_id,
                FranchiseeSpeedRule.technician_type,
                FranchiseeSpeedRule.model_id,
            ],
            index_where=FranchiseeSpeedRule.model_id.is_not(None),
            set_={
                "reward_within_hours": body.rewardWithinHours,
                "penalty_after_hours": body.penaltyAfterHours,
                "reward_paise": body.rewardPaise,
                "penalty_paise": body.penaltyPaise,
                "updated_by": by_user,
            },
        )
    else:
        stmt = stmt.on_conflict_do_update(
            index_elements=[
                FranchiseeSpeedRule.company_id,
                FranchiseeSpeedRule.franchisee_id,
                FranchiseeSpeedRule.technician_type,
                FranchiseeSpeedRule.node_id,
            ],
            index_where=FranchiseeSpeedRule.node_id.is_not(None),
            set_={
                "reward_within_hours": body.rewardWithinHours,
                "penalty_after_hours": body.penaltyAfterHours,
                "reward_paise": body.rewardPaise,
                "penalty_paise": body.penaltyPaise,
                "updated_by": by_user,
            },
        )
    stmt = stmt.returning(FranchiseeSpeedRule)
    row = (await db.execute(stmt)).scalar_one()
    await db.flush()  # hard rule 10 — the response and the next read agree
    return await _one_out(db, row)


async def delete_rule(
    db: AsyncSession, *, company_id: uuid.UUID, franchisee_id: uuid.UUID,
    rule_id: uuid.UUID,
) -> None:
    """Remove one row — deleting a node's rule restores inheritance to what is
    beneath it, which is why there is no soft delete here (S1's docstring).
    404 for another franchisee's or company's id. Flushes, does not commit."""
    row = await db.scalar(
        select(FranchiseeSpeedRule).where(
            FranchiseeSpeedRule.company_id == company_id,
            FranchiseeSpeedRule.franchisee_id == franchisee_id,
            FranchiseeSpeedRule.id == rule_id,
        )
    )
    if row is None:
        raise AppError(404, "NOT_FOUND", "Speed rule not found")
    await db.delete(row)
    await db.flush()


async def catalogue(db: AsyncSession, *, company_id: uuid.UUID) -> SpeedCatalogueOut:
    """The rule editor's two pickers, each in one query, price-free (W16).

    Nodes at ANY depth — a root carries over its children just as a leaf
    carries over its models — and approved, live models only.
    """
    node_rows = list(
        await db.scalars(
            select(ProductNode)
            .where(
                ProductNode.company_id == company_id,
                ProductNode.deleted_at.is_(None),
            )
            .order_by(ProductNode.depth, ProductNode.sort_order)
        )
    )
    model_rows = list(
        await db.scalars(
            select(ProductModel)
            .where(
                ProductModel.company_id == company_id,
                ProductModel.deleted_at.is_(None),
                ProductModel.approval_status == APPROVED,
            )
            .order_by(ProductModel.name)
        )
    )
    brand_ids = {m.brand_id for m in model_rows}
    brands = {
        b.id: b.name
        for b in await db.scalars(
            select(VendorBrand).where(
                VendorBrand.company_id == company_id,
                VendorBrand.id.in_(brand_ids),
            )
        )
    } if brand_ids else {}
    return SpeedCatalogueOut(
        nodes=[
            SpeedCatalogueNodeOut(
                id=n.id, parentId=n.parent_id, name=n.name, depth=n.depth,
                isLeaf=n.is_leaf, isActive=n.is_active,
            )
            for n in node_rows
        ],
        models=[
            SpeedCatalogueModelOut(
                id=m.id, nodeId=m.node_id, name=m.name,
                brandName=brands.get(m.brand_id, _GONE),
            )
            for m in model_rows
        ],
    )


# ── the shape of one row — names, paths, hints ───────────────────────────────


async def _rule_outs(
    db: AsyncSession,
    rows: list[FranchiseeSpeedRule], *, company_id: uuid.UUID,
) -> dict[uuid.UUID, SpeedRuleOut]:
    """Every row of one read shaped and hinted at once.

    Two loader queries name all the targets: the nodes (with their
    `ancestor_ids`, which rebuilds every root-first path in memory) and the
    models (with their brand names, which `catalogue` reads the same way).
    Every query is company-scoped (tenancy rule 0) even though the ids were
    collected from rows already filtered to this company — the composite FKs
    make a cross-tenant id unwritable, but the reads are scoped anyway because
    that is the rule a future reader can trust without re-deriving it.
    A hard-gone id is simply absent from the index, and `_GONE` stands in for
    the name it has taken with it.
    """
    if not rows:
        return {}

    node_ids = {r.node_id for r in rows if r.node_id is not None}
    model_ids = {r.model_id for r in rows if r.model_id is not None}

    nodes: dict[uuid.UUID, ProductNode] = {}
    if node_ids:
        nodes = {
            n.id: n
            for n in await db.scalars(
                select(ProductNode).where(
                    ProductNode.company_id == company_id,
                    ProductNode.id.in_(node_ids),
                )
            )
        }
        ancestor_ids = {a for n in nodes.values() for a in n.ancestor_ids}
        ancestors: dict[uuid.UUID, ProductNode] = {}
        if ancestor_ids:
            ancestors = {
                n.id: n
                for n in await db.scalars(
                    select(ProductNode).where(
                        ProductNode.company_id == company_id,
                        ProductNode.id.in_(ancestor_ids),
                    )
                )
            }

        def _path(nid: uuid.UUID) -> list[ProductNode]:
            n = nodes.get(nid)
            if n is None:
                return []
            chain = [ancestors.get(a) for a in n.ancestor_ids] + [n]
            return [part for part in chain if part is not None]

        paths = {nid: _path(nid) for nid in nodes}
    else:
        paths, ancestors = {}, {}

    models: dict[uuid.UUID, ProductModel] = {}
    if model_ids:
        models = {
            m.id: m
            for m in await db.scalars(
                select(ProductModel).where(
                    ProductModel.company_id == company_id,
                    ProductModel.id.in_(model_ids),
                )
            )
        }

    # The "beneath" test: does one ROW'S target sit inside this node's subtree?
    # A node row does when its own path contains this node's id; a model row
    # when its node's path does. Both read out of the same dictionaries.
    under_node: dict[uuid.UUID, dict[str, list[FranchiseeSpeedRule]]] = {}
    for r in rows:
        if r.node_id is None:
            continue
        for superior in paths.get(r.node_id, []):
            under_node.setdefault(superior.id, {}).setdefault(
                r.technician_type, []
            ).append(r)

    def _path_names(r: FranchiseeSpeedRule) -> list[str]:
        if r.model_id is not None and r.model_id in models:
            node = nodes.get(models[r.model_id].node_id)
            names = [p.name for p in paths.get(node.id, [])] if node else []
            return [*names, models[r.model_id].name]
        if r.node_id in nodes:
            return [p.name for p in paths[r.node_id]]
        return [_GONE]

    def _override(r: FranchiseeSpeedRule) -> FranchiseeSpeedRule | None:
        """The nearest shallower node row of the same type this row beats —
        a model row looks up its node's whole path; a node row looks up only
        its ancestors (it does not "override" itself). Deepest wins."""
        if r.model_id is not None and r.model_id in models:
            node = nodes.get(models[r.model_id].node_id)
            chain = [p.id for p in paths.get(node.id, [])] if node else []
        elif r.node_id in nodes:
            chain = list(nodes[r.node_id].ancestor_ids)
        else:
            chain = []
        same_type = {
            x.node_id: x for x in rows
            if x.technician_type == r.technician_type and x.node_id is not None
        }
        for nid in reversed(chain):        # nearest first
            if nid in same_type and nid != r.node_id:
                return same_type[nid]
        return None

    def _active(r: FranchiseeSpeedRule) -> bool:
        if r.model_id is not None:
            m = models.get(r.model_id)
            return m is not None and m.deleted_at is None and m.is_active
        n = nodes.get(r.node_id)
        return n is not None and n.deleted_at is None and n.is_active

    def _name(r: FranchiseeSpeedRule) -> str:
        if r.model_id is not None:
            m = models.get(r.model_id)
            return m.name if m is not None else _GONE
        n = nodes.get(r.node_id)
        return n.name if n is not None else _GONE

    outs: dict[uuid.UUID, SpeedRuleOut] = {}
    for r in rows:
        override = _override(r)
        if r.model_id is not None:
            beneath: list[FranchiseeSpeedRule] = []   # nothing sits beneath a model
        else:
            beneath = under_node.get(r.node_id, {}).get(r.technician_type, [])
        outs[r.id] = SpeedRuleOut(
            id=r.id,
            technicianType=r.technician_type,
            targetKind="model" if r.model_id is not None else "node",
            targetId=r.model_id if r.model_id is not None else r.node_id,
            targetName=_name(r),
            targetPath=_path_names(r),
            targetActive=_active(r),
            rewardWithinHours=r.reward_within_hours,
            penaltyAfterHours=r.penalty_after_hours,
            rewardPaise=r.reward_paise,
            penaltyPaise=r.penalty_paise,
            overridesRuleId=override.id if override is not None else None,
            overridesName=_name(override) if override is not None else None,
            overriddenBy=sum(
                1 for b in beneath if b.id != r.id and b.model_id is not None
            )
            + sum(
                1 for b in beneath
                if b.id != r.id and b.model_id is None
                and nodes.get(b.node_id) is not None
                and nodes[b.node_id].depth > (nodes.get(r.node_id).depth if r.node_id in nodes else 0)
            ),
            updatedAt=r.updated_at,
        )
    return outs


async def _one_out(db: AsyncSession, row: FranchiseeSpeedRule) -> SpeedRuleOut:
    """One freshly-written row, fetched with its neighbours so the same hints
    the list shows are right the moment it lands."""
    siblings = list(
        await db.scalars(
            select(FranchiseeSpeedRule).where(
                FranchiseeSpeedRule.company_id == row.company_id,
                FranchiseeSpeedRule.franchisee_id == row.franchisee_id,
            )
        )
    )
    outs = await _rule_outs(db, siblings, company_id=row.company_id)
    out = outs.get(row.id)
    if out is not None:
        return out
    raise AppError(404, "NOT_FOUND", "Speed rule not found")    # unreachable


async def _load_node(
    db: AsyncSession, *, company_id: uuid.UUID, node_id: uuid.UUID
) -> ProductNode:
    """The category the preview names, live or gone — 404 otherwise.

    Company-scoped FIRST, and the deleted check rides in the same WHERE: a
    soft-deleted node is `targetActive: false` in the LIST for the reason the
    module docstring gives (tickets already raised against it), but a preview
    has nothing to judge yet, so a dead target is simply not one this screen
    can answer about. A guessed id never says it exists (tenancy rule 0).
    """
    node = await db.scalar(
        select(ProductNode).where(
            ProductNode.company_id == company_id,
            ProductNode.id == node_id,
            ProductNode.deleted_at.is_(None),
        )
    )
    if node is None:
        raise AppError(404, "NOT_FOUND", "Category not found")
    return node


async def _load_model(
    db: AsyncSession, *, company_id: uuid.UUID, model_id: uuid.UUID
) -> ProductModel:
    """The product the preview names, live — 404 otherwise. The approval gate
    (422 `SPEED_MODEL_NOT_APPROVED`) stays in the CALLER, which is the only
    place that can phrase the two failures differently."""
    model = await db.scalar(
        select(ProductModel).where(
            ProductModel.company_id == company_id,
            ProductModel.id == model_id,
            ProductModel.deleted_at.is_(None),
        )
    )
    if model is None:
        raise AppError(404, "NOT_FOUND", "Product not found")
    return model