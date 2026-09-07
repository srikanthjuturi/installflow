"""Product master service — a recursive node tree with priced products as leaves.

Every read and write is filtered by `principal.company_id` and `deleted_at IS
NULL`. There is no territory scoping: a product catalogue is company-wide, not
regional, so an area manager sees the same list a national head does.

Deletes are soft and refuse to orphan, now over the whole SUBTREE: deleting *TV*
is a 409 if anything beneath it still has products or certified technicians. The
message names what is in the way, because "cannot delete" without a reason sends
the user hunting — and with depth it may be several levels down from what they
clicked.

## Why the tree is still assembled in Python

`get_tree` does two flat queries and nests them by `parent_id`, rather than a
recursive CTE. The catalogue is tens of rows; it feeds the technician form,
ticket intake and the mobile coverage screen; and doing it here is what lets
icon inheritance and the breadcrumb both fall out of ONE top-down pass with no
extra round trips. Rows arrive ordered by depth, so a parent is always built
before its children and each can simply read what its parent resolved.
"""

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Principal
from app.core.errors import AppError
from app.core.icons import DEFAULT_ICON_KEY
from app.core.notifications import notify
from app.core.product_tree import (
    APPROVAL_STATES,
    APPROVED,
    CATALOGUE,
    INTAKE,
    MAX_NODE_DEPTH,
    PENDING,
    REJECTED,
)
from app.core.realtime import publish_notification
from app.core.schemas import ListParams, canonical_filter
from app.db.repository import paginate
from app.features.masters.schemas import (
    ApprovalRequest,
    ModelCreateRequest,
    ModelUpdateRequest,
    NodeCreateRequest,
    NodeUpdateRequest,
    ParameterOut,
    ProductApprovalOut,
    ProductModelOut,
    ProductNodeOut,
    ProductResubmitRequest,
    ProductSubmitRequest,
    RejectionRequest,
)
from app.models.product import ProductModel, ProductNode
from app.models.product_node_rules import ProductNodeRules
from app.models.technician import TechnicianNode
from app.models.user import User
from app.models.vendor import Vendor


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _not_found(what: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{what} not found")


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


# ── loaders ───────────────────────────────────────────────────────────────────


async def _load_node(
    db: AsyncSession, company_id: uuid.UUID, node_id: uuid.UUID
) -> ProductNode:
    row = await db.scalar(
        select(ProductNode).where(
            ProductNode.id == node_id,
            ProductNode.company_id == company_id,
            ProductNode.deleted_at.is_(None),
        )
    )
    if row is None:
        raise _not_found("Category")
    return row


async def _load_model(
    db: AsyncSession, company_id: uuid.UUID, model_id: uuid.UUID
) -> ProductModel:
    row = await db.scalar(
        select(ProductModel).where(
            ProductModel.id == model_id,
            ProductModel.company_id == company_id,
            ProductModel.deleted_at.is_(None),
        )
    )
    if row is None:
        raise _not_found("Product model")
    return row


async def _load_own_model(
    db: AsyncSession, principal: Principal, model_id: uuid.UUID
) -> ProductModel:
    """The CALLER'S OWN product, or 404.

    Two predicates, not one. `_load_model` proves the row belongs to this
    company, which is the boundary for staff; for a vendor it is not — hard rule
    7 says a vendor sees only its own, and this applies that to a WRITE. Without
    the second line a vendor could edit a competitor's product by guessing an id
    inside the same tenant.

    404 and never 403, like every other scoped loader here: a 403 confirms the
    row exists.
    """
    row = await db.scalar(
        select(ProductModel).where(
            ProductModel.id == model_id,
            ProductModel.company_id == principal.company_id,
            ProductModel.vendor_id == principal.vendor_id,
            ProductModel.deleted_at.is_(None),
        )
    )
    if row is None:
        raise _not_found("Product model")
    return row


async def _load_reviewable(
    db: AsyncSession, company_id: uuid.UUID, model_id: uuid.UUID
) -> ProductModel:
    """A product still awaiting a decision, or a 409 naming why not.

    A coded conflict rather than a bare 409, because two National Heads can have
    the queue open at once and the second one's prices would otherwise silently
    overwrite the first's. The console refetches on `ALREADY_DECIDED` instead of
    showing a refusal the reader cannot place.
    """
    row = await _load_model(db, company_id, model_id)
    if row.approval_status != PENDING:
        raise AppError(
            status_code=status.HTTP_409_CONFLICT,
            code="ALREADY_DECIDED",
            detail=(
                f"{row.name} has already been reviewed. Refresh the queue to "
                "see the decision."
            ),
        )
    return row


# ── helpers ───────────────────────────────────────────────────────────────────


async def _next_sort(db: AsyncSession, stmt) -> int:
    current = await db.scalar(stmt)
    return int(current or 0) + 1


async def _assert_node_name_free(
    db: AsyncSession,
    company_id: uuid.UUID,
    parent_id: uuid.UUID | None,
    name: str,
    *,
    exclude_id: uuid.UUID | None = None,
) -> None:
    """Unique among SIBLINGS, case-insensitively.

    `company_id` is in the predicate even for a child, where `parent_id` already
    implies it — it costs nothing, it lets one function serve both cases, and it
    matches the unique index, which needs the company for roots because their
    `parent_id` is NULL.
    """
    stmt = select(ProductNode.id).where(
        ProductNode.company_id == company_id,
        ProductNode.deleted_at.is_(None),
        func.lower(ProductNode.name) == name.lower(),
    )
    stmt = stmt.where(
        ProductNode.parent_id.is_(None)
        if parent_id is None
        else ProductNode.parent_id == parent_id
    )
    if exclude_id is not None:
        stmt = stmt.where(ProductNode.id != exclude_id)
    if await db.scalar(stmt) is not None:
        raise _conflict(
            f"A category called {name} already exists here"
            if parent_id is not None
            else f"A category called {name} already exists"
        )


async def _assert_model_name_free(
    db: AsyncSession,
    node_id: uuid.UUID,
    name: str,
    *,
    exclude_id: uuid.UUID | None = None,
) -> None:
    stmt = select(ProductModel.id).where(
        ProductModel.node_id == node_id,
        ProductModel.deleted_at.is_(None),
        func.lower(ProductModel.name) == name.lower(),
    )
    if exclude_id is not None:
        stmt = stmt.where(ProductModel.id != exclude_id)
    if await db.scalar(stmt) is not None:
        raise _conflict(f"This category already has a model called {name}")


async def _validate_vendor(
    db: AsyncSession, company_id: uuid.UUID, vendor_id: uuid.UUID
) -> uuid.UUID:
    """Resolve a client-supplied vendor id inside the caller's own company.

    A scoped query, not a bare load: the id arrives in a request body, which
    makes it an assertion rather than a fact. Cross-company ids and paused
    vendors both fail here, so the composite FK never has to be the thing that
    catches them.

    This queries the Vendor MODEL directly rather than calling the vendors
    service — hard rule 4 forbids one slice importing another's service, while
    sharing models across slices is normal (technicians reads ProductNode the
    same way).
    """
    found = await db.scalar(
        select(Vendor.id).where(
            Vendor.id == vendor_id,
            Vendor.company_id == company_id,
            Vendor.is_active.is_(True),
            Vendor.deleted_at.is_(None),
        )
    )
    if found is None:
        raise _bad_request("Unknown or inactive vendor")
    return found


async def descendant_ids(
    db: AsyncSession, company_id: uuid.UUID, node_id: uuid.UUID
) -> list[uuid.UUID]:
    """Every live node beneath `node_id`, at any depth. Excludes the node itself.

    One indexed array containment probe rather than a recursive CTE — this is
    what `ancestor_ids` is for.
    """
    rows = await db.scalars(
        select(ProductNode.id).where(
            ProductNode.company_id == company_id,
            ProductNode.deleted_at.is_(None),
            ProductNode.ancestor_ids.any(node_id),
        )
    )
    return list(rows)


# ── read ──────────────────────────────────────────────────────────────────────


def _params_out(entries) -> list[ParameterOut]:
    return [
        ParameterOut(name=e.get("name", ""), value=e.get("value", ""))
        for e in (entries or [])
    ]


async def get_tree(
    db: AsyncSession,
    principal: Principal,
    *,
    include_inactive: bool = False,
    vendor_id: uuid.UUID | None = None,
    purpose: str = CATALOGUE,
) -> list[ProductNodeOut]:
    """The whole catalogue in one response, nested to whatever depth it has.

    Flat queries assembled in Python rather than a nested eager load or a
    recursive CTE: the catalogue is small (tens of rows), and it feeds the
    technician form, ticket intake and the mobile coverage screen, where a
    second round trip on a field connection costs more than the join would have.

    `vendor_id` narrows it to ONE BRAND'S catalogue: only that vendor's models.
    A ticket is raised against a specific vendor's product, so intake picks the
    vendor first and everything below it follows.

    Technician certification deliberately does NOT pass this — a technician is
    skilled at Televisions whoever made them, and scoping that by brand would
    mean re-certifying everybody each time a vendor is onboarded.

    For a VENDOR caller the parameter is ignored and their own id substituted:
    see below.

    ## `purpose` — am I filling this in, or picking from it?

        catalogue   every approval state, and empty branches KEPT. The ops
                    Categories screen, the vendor's own product screen, and the
                    subtree every write echoes back.
        intake      approved products only, and empty branches pruned. The
                    ticket form's pickers.

    One parameter rather than two booleans, because the two settings are not
    independent choices. A caller that could ask for approved-only while keeping
    empty branches would get a picker full of dead ends — which is the thing the
    pruning exists to prevent. Same reasoning as `_flatten_for_invite` narrowing
    what the phone is SENT rather than teaching the phone to filter.

    `catalogue` is the default, and that direction is deliberate: an older
    client that does not send the parameter keeps seeing everything, which is a
    cosmetic surprise. Defaulting to `intake` would silently empty the
    maintenance screens the day it shipped.

    A node whose parent was filtered out is DROPPED, never promoted to a root.
    Pausing *TV* has to take *Android TV* with it; a child that floated up to the
    top level would be offered as a choice its own parent had withdrawn.
    """
    company_id = principal.company_id
    for_intake = purpose == INTAKE

    node_stmt = select(ProductNode).where(
        ProductNode.company_id == company_id,
        ProductNode.deleted_at.is_(None),
    )
    model_stmt = select(ProductModel).where(
        ProductModel.company_id == company_id,
        ProductModel.deleted_at.is_(None),
    )
    if not include_inactive:
        node_stmt = node_stmt.where(ProductNode.is_active.is_(True))
        model_stmt = model_stmt.where(ProductModel.is_active.is_(True))
    # A vendor sees ITS OWN catalogue and no other, whatever it asked for. The
    # parameter is a convenience for staff picking a brand; for a vendor it
    # would be the tenancy boundary sitting in a query string — drop it and a
    # vendor could enumerate every competitor's models in the company.
    if principal.is_vendor:
        vendor_id = principal.vendor_id
    if vendor_id is not None:
        model_stmt = model_stmt.where(ProductModel.vendor_id == vendor_id)
    # A product nobody has agreed to is not one a ticket can be raised against —
    # it has no prices to stamp. This is the NORMAL path that keeps unapproved
    # products out of every picker; `tickets._resolve_product` refuses one again
    # for the stale tab and the crafted request.
    if for_intake:
        model_stmt = model_stmt.where(ProductModel.approval_status == APPROVED)

    # Depth first in the ORDER BY, so every parent is built before its children
    # and the top-down pass below can read what its parent resolved.
    nodes = list(
        await db.scalars(
            node_stmt.order_by(
                ProductNode.depth, ProductNode.sort_order, ProductNode.name
            )
        )
    )
    models = list(
        await db.scalars(model_stmt.order_by(ProductModel.sort_order, ProductModel.name))
    )

    # One extra query for the brand names, joined in Python like everything else
    # here. Not filtered to the models on hand: the catalogue is tens of rows and
    # this keeps a removed-but-still-referenced vendor resolvable.
    vendor_rows = await db.execute(
        select(Vendor.id, Vendor.name).where(Vendor.company_id == company_id)
    )
    vendor_names = {row_id: name for row_id, name in vendor_rows}

    node_ids = [n.id for n in nodes]
    coverage = await _coverage_counts(db, company_id, nodes)
    overriding = await _nodes_with_rule_overrides(db, company_id, node_ids)

    models_by_node: dict[uuid.UUID, list[ProductModel]] = {}
    for m in models:
        models_by_node.setdefault(m.node_id, []).append(m)

    built: dict[uuid.UUID, ProductNodeOut] = {}
    # The two things carried down as we go: the resolved icon, and the
    # breadcrumb (which is `parent.path` plus this node's name).
    resolved_icon: dict[uuid.UUID, str] = {}
    roots: list[ProductNodeOut] = []

    for n in nodes:
        parent = built.get(n.parent_id) if n.parent_id is not None else None
        if n.parent_id is not None and parent is None:
            # Its parent was filtered out (paused, or another brand's branch).
            # Skipping it also skips everything below, because nothing will find
            # it in `built` either.
            continue

        icon = n.icon_key or (
            resolved_icon.get(n.parent_id, DEFAULT_ICON_KEY)
            if n.parent_id is not None
            else DEFAULT_ICON_KEY
        )
        resolved_icon[n.id] = icon

        path = (parent.path if parent is not None else []) + [n.name]

        out = ProductNodeOut(
            id=n.id,
            parentId=n.parent_id,
            name=n.name,
            depth=n.depth,
            path=path,
            iconKey=icon,
            ownIconKey=n.icon_key,
            isLeaf=n.is_leaf,
            isActive=n.is_active,
            sortOrder=n.sort_order,
            technicianCount=coverage.get(n.id, 0),
            hasRuleOverrides=n.id in overriding,
            parameters=_params_out(n.parameters),
            children=[],
            models=[
                ProductModelOut(
                    id=m.id,
                    nodeId=m.node_id,
                    vendorId=m.vendor_id,
                    vendorName=vendor_names.get(m.vendor_id, ""),
                    name=m.name,
                    serviceTypes=list(m.service_types or []),
                    capacity=m.capacity,
                    warrantyMonths=m.warranty_months,
                    notes=m.notes,
                    parameters=_params_out(m.parameters),
                    # THE masking point for the technician's rate.
                    #
                    # A vendor calls this endpoint — `masters.view` is granted so
                    # their intake form has a product tree — so without this line
                    # every vendor could read what we pay technicians straight out
                    # of the network tab. Withheld the same way the caller's own
                    # `vendor_id` is forced above: the branch is already here, and
                    # this is the same fact it is branching on.
                    #
                    # Their own price is not withheld. It is what they are charged.
                    technicianPayoutPaise=(
                        None if principal.is_vendor else m.technician_payout_paise
                    ),
                    vendorPricePaise=m.vendor_price_paise,
                    imageUrls=list(m.image_urls or []),
                    isActive=m.is_active,
                    approvalStatus=m.approval_status,
                    rejectionReason=m.rejection_reason,
                    sortOrder=m.sort_order,
                )
                for m in models_by_node.get(n.id, [])
            ],
        )
        built[n.id] = out
        if parent is None:
            roots.append(out)
        else:
            parent.children.append(out)

    if not for_intake:
        return roots
    # A picker prunes upward: a branch holding nothing the caller could choose
    # is not a choice, and offering it would dead-end below. On a maintenance
    # screen every node stays — an empty one is a real part of the master that
    # somebody still has to fill.
    #
    # Driven by `purpose` rather than by `vendor_id is not None`, which is what
    # it used to test. That old trigger silently 404'd a vendor's own category
    # create: `create_node` echoes the affected branch back through `_one_root`,
    # a brand-new category has no models, and it was pruned out of the response
    # to a write that had already committed.
    return [root for root in roots if _prune_empty_branches(root)]


def _prune_empty_branches(node: ProductNodeOut) -> bool:
    """Drop branches with no models left. True if this node survives.

    Bottom-up, because a node with no models of its own is still worth keeping
    when something below it has some.

    Named for what it does rather than for why it was first needed: it used to
    run only when the tree was narrowed to one brand, so it was `_prune_to_vendor`.
    It now also drops branches emptied by hiding unapproved products, and the
    rule underneath both is the same — a branch that offers nothing is not a
    choice.
    """
    node.children = [child for child in node.children if _prune_empty_branches(child)]
    return bool(node.models or node.children)


async def _coverage_counts(
    db: AsyncSession, company_id: uuid.UUID, nodes: list[ProductNode]
) -> dict[uuid.UUID, int]:
    """How many technicians could take a job on each node.

    Certification is descendant-aware, so this counts anyone certified on the
    node OR on any ancestor of it. The console shows this number ("34
    technicians certified"), and it is exactly the kind of figure that quietly
    stays seed data forever if nobody wires it.

    Counted as a SET per node, not a sum of per-node tallies: somebody certified
    on both *TV* and *Android TV* is one technician, and a sum would report two.
    The pairs are fetched whole because the catalogue is small and the join is
    then a dictionary lookup rather than one query per node.
    """
    if not nodes:
        return {}
    rows = await db.execute(
        select(TechnicianNode.node_id, TechnicianNode.technician_id).where(
            TechnicianNode.company_id == company_id
        )
    )
    direct: dict[uuid.UUID, set[uuid.UUID]] = {}
    for node_id, technician_id in rows:
        direct.setdefault(node_id, set()).add(technician_id)
    if not direct:
        return {}

    counts: dict[uuid.UUID, int] = {}
    for n in nodes:
        covering: set[uuid.UUID] = set()
        for ancestor in (*n.ancestor_ids, n.id):
            covering |= direct.get(ancestor, set())
        if covering:
            counts[n.id] = len(covering)
    return counts


async def _direct_certifications(
    db: AsyncSession, node_ids: list[uuid.UUID]
) -> int:
    """Technicians certified on exactly these nodes — the delete gate's question.

    Different from `_coverage_counts` on purpose. Deleting *TV* is blocked by the
    certification ROWS that would be orphaned, which are the ones naming *TV* or
    something under it. Somebody certified on *Electronics* covers *TV* but has
    no row pointing at it, and deleting it takes nothing from them.
    """
    if not node_ids:
        return 0
    return int(
        await db.scalar(
            select(func.count(func.distinct(TechnicianNode.technician_id))).where(
                TechnicianNode.node_id.in_(node_ids)
            )
        )
        or 0
    )


async def _nodes_with_rule_overrides(
    db: AsyncSession, company_id: uuid.UUID, node_ids: list[uuid.UUID]
) -> set[uuid.UUID]:
    """Which nodes carry a rules row, for the tree's badge. Ids only."""
    if not node_ids:
        return set()
    rows = await db.scalars(
        select(ProductNodeRules.node_id).where(
            ProductNodeRules.company_id == company_id,
            ProductNodeRules.node_id.in_(node_ids),
        )
    )
    return set(rows)


async def _one_root(
    db: AsyncSession, principal: Principal, node_id: uuid.UUID
) -> ProductNodeOut:
    """Re-read the whole ROOT branch a node belongs to, as the client sees it.

    Every write answers with this rather than with the row it touched, because a
    change at any depth can move a count, an inherited icon or an inherited
    parameter anywhere below it. Returning the branch means the console replaces
    one subtree and is correct, instead of patching a row and being subtly
    stale.
    """
    tree = await get_tree(db, principal, include_inactive=True)
    for root in tree:
        if _contains(root, node_id):
            return root
    raise _not_found("Category")


def _contains(node: ProductNodeOut, node_id: uuid.UUID) -> bool:
    if node.id == node_id:
        return True
    return any(_contains(child, node_id) for child in node.children)


# ── nodes ─────────────────────────────────────────────────────────────────────


async def create_node(
    db: AsyncSession, principal: Principal, body: NodeCreateRequest
) -> ProductNodeOut:
    """Add a category, at the root or under any existing node.

    `depth` and `ancestor_ids` are derived from the parent HERE and nowhere
    else. That is the whole reason a node cannot be moved afterwards: one writer
    means the array can never disagree with the `parent_id` chain, and the CHECK
    on the table catches it if it somehow does.
    """
    company_id = principal.company_id
    name = body.name.strip()

    parent: ProductNode | None = None
    if body.parentId is not None:
        parent = await _load_node(db, company_id, body.parentId)
        # A leaf holds products, not more levels. Refused here rather than left
        # to produce a node nothing could ever be added to.
        if parent.is_leaf:
            raise _bad_request(
                f"{parent.name} is marked as the last sub-category, so it holds "
                "products rather than more sub-categories. Untick that first."
            )
        if parent.depth + 1 > MAX_NODE_DEPTH:
            raise _bad_request(
                f"{parent.name} is already {MAX_NODE_DEPTH} levels deep. "
                "Mark it as the last sub-category and add the products there."
            )
    if body.isLeaf and parent is None:
        raise _bad_request(
            "A top-level category cannot hold products directly. Add a "
            "sub-category and mark that one as the last."
        )
    # A template on a node that holds no products describes nothing, and the
    # CHECK on the table refuses it — caught here so the message names the fix.
    if body.parameters and not body.isLeaf:
        raise _bad_request(
            "Only the last sub-category carries fields, because only it holds "
            "products. Tick \"This is the last sub-category\" first."
        )

    await _assert_node_name_free(db, company_id, body.parentId, name)

    sort_stmt = select(func.max(ProductNode.sort_order)).where(
        ProductNode.company_id == company_id,
        ProductNode.deleted_at.is_(None),
    )
    sort_stmt = sort_stmt.where(
        ProductNode.parent_id.is_(None)
        if parent is None
        else ProductNode.parent_id == parent.id
    )

    row = ProductNode(
        company_id=company_id,
        parent_id=parent.id if parent else None,
        name=name,
        icon_key=body.iconKey,
        depth=(parent.depth + 1) if parent else 0,
        ancestor_ids=([*parent.ancestor_ids, parent.id] if parent else []),
        is_leaf=body.isLeaf,
        parameters=list(body.parameters),
        is_active=body.isActive,
        sort_order=await _next_sort(db, sort_stmt),
        created_by=principal.user_id,
    )
    db.add(row)
    await db.commit()
    return await _one_root(db, principal, row.id)


async def update_node(
    db: AsyncSession,
    principal: Principal,
    node_id: uuid.UUID,
    body: NodeUpdateRequest,
) -> ProductNodeOut:
    row = await _load_node(db, principal.company_id, node_id)

    if body.name is not None:
        name = body.name.strip()
        await _assert_node_name_free(
            db, principal.company_id, row.parent_id, name, exclude_id=node_id
        )
        row.name = name
    # An explicit null resets the icon to "inherit", so this reads the payload
    # rather than testing for None.
    if "iconKey" in body.model_fields_set:
        row.icon_key = body.iconKey
    if body.isLeaf is not None and body.isLeaf != row.is_leaf:
        await _assert_can_switch_leaf(db, principal.company_id, row, body.isLeaf)
        row.is_leaf = body.isLeaf
        # Un-ticking takes the template with it: the node no longer holds
        # products, so there is nothing left for it to describe.
        if not row.is_leaf:
            row.parameters = []
    if body.parameters is not None:
        if body.parameters and not row.is_leaf:
            raise _bad_request(
                "Only the last sub-category carries fields, because only it "
                "holds products."
            )
        # A new list, not a mutation: SQLAlchemy does not track JSONB in place.
        row.parameters = list(body.parameters)
    if body.isActive is not None:
        row.is_active = body.isActive
    if body.sortOrder is not None:
        row.sort_order = body.sortOrder
    row.updated_by = principal.user_id

    await db.commit()
    return await _one_root(db, principal, node_id)


async def _assert_can_switch_leaf(
    db: AsyncSession, company_id: uuid.UUID, row: ProductNode, to_leaf: bool
) -> None:
    """Refuse a switch that would strand what is already under this node.

    The flag is stored rather than derived, so it CAN disagree with the rows
    below it — these two checks are what stop it. Turning it off while products
    hang here would leave them on a node the tree no longer draws them on;
    turning it on while sub-categories hang here would do the same to them.
    """
    if to_leaf:
        if row.depth < 1:
            raise _bad_request(
                "A top-level category cannot hold products directly. Add a "
                "sub-category and mark that one as the last."
            )
        children = await db.scalar(
            select(func.count(ProductNode.id)).where(
                ProductNode.parent_id == row.id,
                ProductNode.deleted_at.is_(None),
            )
        )
        if children:
            raise _conflict(
                f"{row.name} still has {children} sub-categor"
                f"{'y' if children == 1 else 'ies'}, so it is not the last one. "
                "Remove them first."
            )
        return

    models = await db.scalar(
        select(func.count(ProductModel.id)).where(
            ProductModel.node_id == row.id,
            ProductModel.deleted_at.is_(None),
        )
    )
    if models:
        raise _conflict(
            f"{row.name} still holds {models} product"
            f"{'' if models == 1 else 's'}. Remove them before it stops being "
            "the last sub-category."
        )


async def delete_node(
    db: AsyncSession, principal: Principal, node_id: uuid.UUID
) -> None:
    """Soft-delete a node, refusing if anything in its SUBTREE is still in use.

    Three gates, in the order somebody would fix them. Each counts the whole
    subtree, not just the node clicked — with depth, what blocks a delete is
    often several levels down, and a message naming only the node would be true
    and useless.
    """
    row = await _load_node(db, principal.company_id, node_id)
    below = await descendant_ids(db, principal.company_id, node_id)

    live_children = await db.scalar(
        select(func.count(ProductNode.id)).where(
            ProductNode.parent_id == node_id,
            ProductNode.deleted_at.is_(None),
        )
    )
    if live_children:
        raise _conflict(
            f"{row.name} still has {live_children} sub-categor"
            f"{'y' if live_children == 1 else 'ies'}. Remove them first."
        )

    subtree = [node_id, *below]
    live_models = await db.scalar(
        select(func.count(ProductModel.id)).where(
            ProductModel.node_id.in_(subtree),
            ProductModel.deleted_at.is_(None),
        )
    )
    if live_models:
        raise _conflict(
            f"{row.name} still has {live_models} product model"
            f"{'' if live_models == 1 else 's'}. Remove them first."
        )

    certified = await _direct_certifications(db, subtree)
    if certified:
        raise _conflict(
            f"{certified} technician{'' if certified == 1 else 's'} "
            f"{'is' if certified == 1 else 'are'} certified for {row.name}. "
            "Move them to another category first."
        )

    row.deleted_at = _now()
    row.is_active = False
    row.updated_by = principal.user_id
    await db.commit()


# ── models ────────────────────────────────────────────────────────────────────


async def create_model(
    db: AsyncSession,
    principal: Principal,
    node_id: uuid.UUID,
    body: ModelCreateRequest,
) -> ProductNodeOut:
    parent = await _load_node(db, principal.company_id, node_id)
    # Products go on the level somebody MARKED as the last one. Without the flag
    # this was "anything at depth >= 1", which let a product land halfway up a
    # branch that was still being built out.
    if not parent.is_leaf:
        raise _bad_request(
            f"{parent.name} is not marked as the last sub-category. Tick "
            '"This is the last sub-category" on it, or add products to one of '
            "the levels below it."
        )

    name = body.name.strip()
    await _assert_model_name_free(db, node_id, name)
    await _validate_vendor(db, principal.company_id, body.vendorId)

    sort_order = await _next_sort(
        db,
        select(func.max(ProductModel.sort_order)).where(
            ProductModel.node_id == node_id,
            ProductModel.deleted_at.is_(None),
        ),
    )
    db.add(
        ProductModel(
            company_id=principal.company_id,
            node_id=node_id,
            vendor_id=body.vendorId,
            name=name,
            service_types=list(body.serviceTypes),
            capacity=(body.capacity or "").strip() or None,
            warranty_months=body.warrantyMonths,
            notes=(body.notes or "").strip() or None,
            parameters=list(body.parameters),
            technician_payout_paise=body.technicianPayoutPaise,
            vendor_price_paise=body.vendorPricePaise,
            image_urls=list(body.imageUrls),
            is_active=body.isActive,
            # Staff typed both prices, so there is nothing to approve. This
            # writer is `require_staff_principal`-only; a vendor's submission
            # goes through `submit_model` and starts pending.
            #
            # `submitted_at` stays NULL: nothing waited. That is the same claim
            # the backfill makes about every product older than approvals.
            approval_status=APPROVED,
            sort_order=sort_order,
            created_by=principal.user_id,
        )
    )
    await db.commit()
    return await _one_root(db, principal, node_id)


async def update_model(
    db: AsyncSession,
    principal: Principal,
    model_id: uuid.UUID,
    body: ModelUpdateRequest,
) -> ProductNodeOut:
    row = await _load_model(db, principal.company_id, model_id)

    if body.name is not None:
        name = body.name.strip()
        await _assert_model_name_free(db, row.node_id, name, exclude_id=model_id)
        row.name = name
    # Only when the brand actually CHANGES. The console resends the model's
    # existing vendorId on every save, so validating unconditionally made a
    # model uneditable the moment its brand was paused — you could not even fix
    # a typo in the name. That also contradicted what the vendor screen
    # promises: "models already carrying the brand keep it". Moving to a paused
    # vendor is still refused, which is the rule that was actually wanted.
    if body.vendorId is not None and body.vendorId != row.vendor_id:
        await _validate_vendor(db, principal.company_id, body.vendorId)
        row.vendor_id = body.vendorId
    if body.serviceTypes is not None:
        # A new list, not a mutation: SQLAlchemy does not track JSONB in place.
        row.service_types = list(body.serviceTypes)
    if body.parameters is not None:
        row.parameters = list(body.parameters)
    # These can be CLEARED, so they test presence in the payload rather than
    # "is not None" — an explicit null has to mean "remove it", which the other
    # fields' test would read as "leave it alone".
    if "imageUrls" in body.model_fields_set:
        row.image_urls = list(body.imageUrls or [])
    if "capacity" in body.model_fields_set:
        row.capacity = (body.capacity or "").strip() or None
    if "warrantyMonths" in body.model_fields_set:
        row.warranty_months = body.warrantyMonths
    if "notes" in body.model_fields_set:
        row.notes = (body.notes or "").strip() or None
    # Not clearable, so these test `is not None` like `vendorId` rather than
    # presence like the four above: an explicit null must NOT unprice a model.
    # The columns became nullable when vendors could submit products, but that
    # null means "not priced YET" and belongs to the approval flow — an editor
    # reaching for it on an approved model would be refused by
    # `approved_is_priced` anyway, with a constraint error instead of a sentence.
    if body.technicianPayoutPaise is not None:
        row.technician_payout_paise = body.technicianPayoutPaise
    if body.vendorPricePaise is not None:
        row.vendor_price_paise = body.vendorPricePaise
    if body.isActive is not None:
        row.is_active = body.isActive
    if body.sortOrder is not None:
        row.sort_order = body.sortOrder
    row.updated_by = principal.user_id

    await db.commit()
    return await _one_root(db, principal, row.node_id)


async def delete_model(
    db: AsyncSession, principal: Principal, model_id: uuid.UUID
) -> None:
    row = await _load_model(db, principal.company_id, model_id)
    row.deleted_at = _now()
    row.is_active = False
    row.updated_by = principal.user_id
    await db.commit()


# ── a vendor's own submissions ────────────────────────────────────────────────
#
# Their own functions rather than a branch inside `create_model` /
# `update_model`, for three reasons that all point the same way:
#
#   * A route carries ONE feature dependency. Letting a vendor through the staff
#     writer would mean granting them `masters.edit` — which also gates PUT and
#     DELETE on every node and every model in the tenant — or reaching for
#     `require_any_feature`, whose own docstring says it is "deliberately NOT a
#     way to soften a guard".
#   * The bodies are different shapes. `ModelCreateRequest` REQUIRES `vendorId`
#     and both prices; a vendor sends none of the three. Making all three
#     optional on one schema would also let a STAFF caller silently create an
#     unpriced pending product by omitting two keys.
#   * `update_model` is already fifty lines of `model_fields_set` tests. A
#     vendor's edit additionally has to refuse three fields and flip the row
#     back to pending — four conditional behaviours threaded through a function
#     whose difficulty is already that every field has its own presence rule.
#
# The CATEGORY write is the exception and routes straight into `create_node`: a
# category has no vendor dimension, no prices and no approval, so there is
# nothing to branch. That asymmetry is the point — the model write needs its own
# path precisely because two of its columns are caller-dependent.


async def submit_model(
    db: AsyncSession,
    principal: Principal,
    node_id: uuid.UUID,
    body: ProductSubmitRequest,
) -> ProductNodeOut:
    """A vendor adds a product to their own book. Unpriced, and pending."""
    parent = await _load_node(db, principal.company_id, node_id)
    if not parent.is_leaf:
        raise _bad_request(
            f"{parent.name} is not marked as the last sub-category. Tick "
            '"This is the last sub-category" on it, or add products to one of '
            "the levels below it."
        )

    name = body.name.strip()
    await _assert_model_name_free(db, node_id, name)

    sort_order = await _next_sort(
        db,
        select(func.max(ProductModel.sort_order)).where(
            ProductModel.node_id == node_id,
            ProductModel.deleted_at.is_(None),
        ),
    )
    row = ProductModel(
        company_id=principal.company_id,
        node_id=node_id,
        # THE pin. Never from the body — there is no field for it to arrive in,
        # so no future branch can reopen this by forgetting a check.
        vendor_id=principal.vendor_id,
        name=name,
        service_types=list(body.serviceTypes),
        capacity=(body.capacity or "").strip() or None,
        warranty_months=body.warrantyMonths,
        notes=(body.notes or "").strip() or None,
        parameters=list(body.parameters),
        image_urls=list(body.imageUrls),
        technician_payout_paise=None,
        vendor_price_paise=None,
        approval_status=PENDING,
        submitted_at=_now(),
        is_active=True,
        sort_order=sort_order,
        created_by=principal.user_id,
    )
    db.add(row)
    # Sessions run with autoflush=False (hard rule 10), and the notification
    # names the row — so it needs its server-side id before anything reads it.
    await db.flush()
    raised = await _notify_submitted(db, principal, row, parent)
    await db.commit()
    await publish_notification(
        db,
        company_id=principal.company_id,
        pincode=None,
        notification_id=raised,
    )
    return await _one_root(db, principal, node_id)


async def update_own_model(
    db: AsyncSession,
    principal: Principal,
    model_id: uuid.UUID,
    body: ProductResubmitRequest,
) -> ProductNodeOut:
    """A vendor edits their own product. Any real change sends it back."""
    row = await _load_own_model(db, principal, model_id)

    if body.name is not None:
        name = body.name.strip()
        await _assert_model_name_free(db, row.node_id, name, exclude_id=model_id)
        row.name = name
    if body.serviceTypes is not None:
        row.service_types = list(body.serviceTypes)
    if body.parameters is not None:
        row.parameters = list(body.parameters)
    if "imageUrls" in body.model_fields_set:
        row.image_urls = list(body.imageUrls or [])
    if "capacity" in body.model_fields_set:
        row.capacity = (body.capacity or "").strip() or None
    if "warrantyMonths" in body.model_fields_set:
        row.warranty_months = body.warrantyMonths
    if "notes" in body.model_fields_set:
        row.notes = (body.notes or "").strip() or None

    # An approved product that has actually CHANGED is no longer the product
    # that was approved, so it goes back for review.
    #
    # Guarded on a real change rather than on "was this a PUT", because the
    # console resends the whole row on every save — bouncing an approved product
    # for a no-op would make opening the dialog and pressing Save cost somebody
    # their ability to raise tickets.
    #
    # ⚠ Measured BEFORE `updated_by` is stamped, and the order is load-bearing:
    # that column changes whenever a DIFFERENT person saves, so stamping first
    # would make `is_modified` true for a no-op by a colleague. The audit column
    # records who touched the row; it is not one of the facts being reviewed.
    changed = db.is_modified(row)
    row.updated_by = principal.user_id

    raised: uuid.UUID | None = None
    if row.approval_status != PENDING and changed:
        row.approval_status = PENDING
        row.submitted_at = _now()
        # `pending_has_no_decision` enforces the first two and
        # `rejection_reason_only_on_rejected` the third — so a resubmission
        # cannot carry a stale refusal a vendor would keep reading.
        row.decided_at = None
        row.decided_by = None
        row.rejection_reason = None
        # Prices are LEFT ALONE, and that is what lets a reviewer confirm a
        # figure rather than re-price from scratch. Safe because intake gates on
        # `approval_status`, never on "is it priced" — a pending row keeping its
        # old prices is still unticketable.
        parent = await _load_node(db, principal.company_id, row.node_id)
        raised = await _notify_submitted(db, principal, row, parent)

    await db.commit()
    if raised is not None:
        await publish_notification(
            db,
            company_id=principal.company_id,
            pincode=None,
            notification_id=raised,
        )
    return await _one_root(db, principal, row.node_id)


async def delete_own_model(
    db: AsyncSession, principal: Principal, model_id: uuid.UUID
) -> None:
    """A vendor withdraws their own product. Same soft delete as the staff one."""
    row = await _load_own_model(db, principal, model_id)
    row.deleted_at = _now()
    row.is_active = False
    row.updated_by = principal.user_id
    await db.commit()


# ── approvals ─────────────────────────────────────────────────────────────────


async def _notify_submitted(
    db: AsyncSession,
    principal: Principal,
    row: ProductModel,
    parent: ProductNode,
) -> uuid.UUID:
    """Tell staff there is something to price.

    `pincode=None` — a catalogue is company-wide, so there is no place to scope
    this to. The cost is that it reaches every staff reader, including Area
    Managers who hold no `masters.approve` and are refused by the rank floor on
    the queue. Accepted deliberately: the row leaks a product name and a vendor
    name to somebody who can already read both on the Categories screen, the
    volume is units per week, and `technician_joined` already has exactly this
    property. The console hides the kind from a reader without the feature.

    `vendor_id=None` — pointedly. Widening this to the submitting vendor would
    give them a bell about their own action, pointing at a screen they cannot
    open. `vendor_id` is for a vendor who is a PARTY to the event; here they are
    the author.
    """
    vendor_name = await db.scalar(
        select(Vendor.name).where(Vendor.id == row.vendor_id)
    )
    path = " › ".join(await _node_path(db, principal.company_id, parent))
    raised = await notify(
        db,
        company_id=principal.company_id,
        kind="product_submitted",
        title=f"{vendor_name or 'A vendor'} submitted {row.name}",
        detail=f"In {path}. Set both prices to approve it.",
        to="/approvals",
    )
    return raised.id


async def _node_path(
    db: AsyncSession, company_id: uuid.UUID, node: ProductNode
) -> list[str]:
    """The breadcrumb for one node, root first, including its own name.

    One query on `ancestor_ids` rather than a walk, and ordered in Python off
    that array because a `WHERE id IN (...)` returns no order of its own — the
    array IS the order, and sorting by anything else would put *OLED* above
    *Electronics*.
    """
    if not node.ancestor_ids:
        return [node.name]
    rows = await db.execute(
        select(ProductNode.id, ProductNode.name).where(
            ProductNode.id.in_(list(node.ancestor_ids)),
            ProductNode.company_id == company_id,
        )
    )
    by_id = {row_id: name for row_id, name in rows}
    return [by_id[a] for a in node.ancestor_ids if a in by_id] + [node.name]


def _approvals_query(company_id: uuid.UUID):
    return select(ProductModel).where(
        ProductModel.company_id == company_id,
        ProductModel.deleted_at.is_(None),
    )


async def pending_count(db: AsyncSession, principal: Principal) -> int:
    """How many products are waiting. The console's rail badge.

    Its own endpoint rather than the queue's first page, for the reason
    `useUnreadNotificationCount` gives: the rail renders on every screen, and
    "how many are waiting" is a TOTAL — a page of twenty rows cannot say there
    are twenty-three.
    """
    return int(
        await db.scalar(
            select(func.count())
            .select_from(ProductModel)
            .where(
                ProductModel.company_id == principal.company_id,
                ProductModel.deleted_at.is_(None),
                ProductModel.approval_status == PENDING,
            )
        )
        or 0
    )


async def list_approvals(
    db: AsyncSession,
    principal: Principal,
    params: ListParams,
    *,
    status_filter: str | None = None,
) -> tuple[list[ProductApprovalOut], int]:
    """The approvals queue.

    NO territory scoping, deliberately. A catalogue is company-wide — it carries
    no pincode to scope by — and the rank floor on the route means only an
    all-India role reaches this at all. Written down so nobody adds
    `territory_scope` here in six months on the grounds that every other list
    has it.
    """
    stmt = _approvals_query(principal.company_id)

    # Blank means PENDING, not "everything": the queue's job is the backlog, and
    # a reader who opens it wants the work rather than the archive. "all" still
    # widens it, because `canonical_filter` reads the sentinel as "no filter".
    wanted = canonical_filter(status_filter or PENDING, APPROVAL_STATES)
    if wanted is False:
        # An unknown value from an old bookmark yields an empty page rather than
        # a 422 that breaks the whole screen. Filters ride in a shareable query
        # string, so this is the same courtesy `_canonical` does for tickets.
        return [], 0
    if wanted is not None:
        stmt = stmt.where(ProductModel.approval_status == wanted)

    if params.search:
        term = f"%{params.search.strip().lower()}%"
        vendor_hit = (
            select(Vendor.id)
            .where(
                Vendor.company_id == principal.company_id,
                func.lower(Vendor.name).like(term),
            )
            .scalar_subquery()
        )
        node_hit = (
            select(ProductNode.id)
            .where(
                ProductNode.company_id == principal.company_id,
                func.lower(ProductNode.name).like(term),
            )
            .scalar_subquery()
        )
        stmt = stmt.where(
            or_(
                func.lower(ProductModel.name).like(term),
                ProductModel.vendor_id.in_(vendor_hit),
                ProductModel.node_id.in_(node_hit),
            )
        )

    # Two halves running in opposite directions on ONE ascending key, the trick
    # `list_escalations` uses and for the same reason: ordering the same column
    # twice in opposite directions would need two queries, and paging could not
    # span them.
    #
    #   pending  — longest wait first: the vendor who has been blocked longest.
    #   decided  — most recent first: what just happened is what somebody may
    #              need to revisit.
    waited = func.coalesce(ProductModel.submitted_at, ProductModel.created_at)
    is_decided = case((ProductModel.approval_status == PENDING, 0), else_=1)
    within_half = case(
        (
            ProductModel.approval_status == PENDING,
            func.extract("epoch", waited),
        ),
        else_=-func.extract("epoch", func.coalesce(ProductModel.decided_at, waited)),
    )
    # The id tiebreak is not cosmetic: two products submitted in one transaction
    # share `submitted_at` to the microsecond, and without a total key Postgres
    # may order them differently between two OFFSET pages — the bug
    # `notifications._NEWEST_FIRST` documents.
    stmt = stmt.order_by(is_decided.asc(), within_half.asc(), ProductModel.id.asc())

    rows, total = await paginate(db, stmt, page=params.page, limit=params.limit)
    return await _approvals_out(db, principal, rows), total


async def _approvals_out(
    db: AsyncSession, principal: Principal, rows: list[ProductModel]
) -> list[ProductApprovalOut]:
    """Hydrate a page. Four flat lookups, joined in Python like `get_tree`."""
    if not rows:
        return []
    company_id = principal.company_id

    vendor_rows = await db.execute(
        select(Vendor.id, Vendor.name).where(Vendor.company_id == company_id)
    )
    vendor_names = {row_id: name for row_id, name in vendor_rows}

    node_rows = list(
        await db.scalars(
            select(ProductNode).where(
                ProductNode.id.in_({r.node_id for r in rows}),
                ProductNode.company_id == company_id,
            )
        )
    )
    nodes = {n.id: n for n in node_rows}
    names = await db.execute(
        select(ProductNode.id, ProductNode.name).where(
            ProductNode.company_id == company_id
        )
    )
    node_names = {row_id: name for row_id, name in names}

    decider_ids = {r.decided_by for r in rows if r.decided_by is not None}
    decider_names: dict[uuid.UUID, str] = {}
    if decider_ids:
        people = await db.execute(
            select(User.id, User.full_name).where(User.id.in_(decider_ids))
        )
        # `full_name` is nullable, so a person with none resolves to no name at
        # all rather than to an empty string — both clients render "—", which is
        # the honest answer and not a claim that nobody decided.
        decider_names = {row_id: name for row_id, name in people if name}

    coverage = await _coverage_counts(db, company_id, node_rows)

    out: list[ProductApprovalOut] = []
    for r in rows:
        node = nodes.get(r.node_id)
        path = (
            [node_names[a] for a in (node.ancestor_ids or []) if a in node_names]
            + [node.name]
            if node is not None
            else []
        )
        out.append(
            ProductApprovalOut(
                id=r.id,
                nodeId=r.node_id,
                nodePath=path,
                vendorId=r.vendor_id,
                vendorName=vendor_names.get(r.vendor_id, ""),
                name=r.name,
                serviceTypes=list(r.service_types or []),
                capacity=r.capacity,
                warrantyMonths=r.warranty_months,
                notes=r.notes,
                parameters=_params_out(r.parameters),
                imageUrls=list(r.image_urls or []),
                approvalStatus=r.approval_status,
                # NOT masked. The rank floor on this route means the reader is a
                # National Head or an Admin, never a vendor.
                technicianPayoutPaise=r.technician_payout_paise,
                vendorPricePaise=r.vendor_price_paise,
                rejectionReason=r.rejection_reason,
                technicianCount=coverage.get(r.node_id, 0),
                submittedAt=r.submitted_at,
                decidedAt=r.decided_at,
                decidedByName=(
                    decider_names.get(r.decided_by) if r.decided_by else None
                ),
            )
        )
    return out


async def _one_approval(
    db: AsyncSession, principal: Principal, row: ProductModel
) -> ProductApprovalOut:
    return (await _approvals_out(db, principal, [row]))[0]


async def _notify_decided(
    db: AsyncSession, principal: Principal, row: ProductModel, *, approved: bool
) -> uuid.UUID:
    """Tell the vendor. Worded so it also reads correctly to staff.

    `vendor_id` WIDENS — it does not narrow — so this row lands in every staff
    feed too, with a `to` pointing at the portal. Accepted, the same compromise
    `assigned` already ships in the other direction. The mitigation is the
    wording: "43 inch LED (Samsung) approved" is true on a manager's screen,
    where "Your product was approved" would not be.

    ⚠ `detail` must never quote `technician_payout_paise`. This row reaches the
    vendor's portal, and one f-string here would undo the masking that
    `get_tree` and `tickets._hydrate` both enforce.
    """
    vendor_name = await db.scalar(
        select(Vendor.name).where(Vendor.id == row.vendor_id)
    )
    label = f"{row.name} ({vendor_name})" if vendor_name else row.name
    raised = await notify(
        db,
        company_id=principal.company_id,
        kind="product_approved" if approved else "product_rejected",
        title=f"{label} approved" if approved else f"{label} needs a change",
        detail=(
            "Tickets can be raised against it now."
            if approved
            else f"Reason: {row.rejection_reason}"
        ),
        to="/portal/products",
        vendor_id=row.vendor_id,
    )
    return raised.id


async def approve_model(
    db: AsyncSession,
    principal: Principal,
    model_id: uuid.UUID,
    body: ApprovalRequest,
) -> ProductApprovalOut:
    row = await _load_reviewable(db, principal.company_id, model_id)
    row.technician_payout_paise = body.technicianPayoutPaise
    row.vendor_price_paise = body.vendorPricePaise
    row.approval_status = APPROVED
    # A re-approval clears the previous refusal, so a vendor never reads a stale
    # rejection against a product that is now live.
    row.rejection_reason = None
    row.decided_at = _now()
    row.decided_by = principal.user_id
    row.updated_by = principal.user_id
    raised = await _notify_decided(db, principal, row, approved=True)
    await db.commit()
    await publish_notification(
        db,
        company_id=principal.company_id,
        pincode=None,
        vendor_id=row.vendor_id,
        notification_id=raised,
    )
    return await _one_approval(db, principal, row)


async def reject_model(
    db: AsyncSession,
    principal: Principal,
    model_id: uuid.UUID,
    body: RejectionRequest,
) -> ProductApprovalOut:
    row = await _load_reviewable(db, principal.company_id, model_id)
    row.approval_status = REJECTED
    row.rejection_reason = body.reason.strip()
    row.decided_at = _now()
    row.decided_by = principal.user_id
    row.updated_by = principal.user_id
    # Prices are NOT written. A rejected product has no agreed price, and
    # leaving a figure on a row nobody signed off is worse than leaving none.
    #
    # `is_active` is not touched either, by neither this nor `approve_model`.
    # Paused and rejected are different facts — see the module docstring on
    # `models/product.py`.
    raised = await _notify_decided(db, principal, row, approved=False)
    await db.commit()
    await publish_notification(
        db,
        company_id=principal.company_id,
        pincode=None,
        vendor_id=row.vendor_id,
        notification_id=raised,
    )
    return await _one_approval(db, principal, row)
