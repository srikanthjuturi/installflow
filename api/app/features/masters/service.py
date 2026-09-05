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
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Principal
from app.core.icons import DEFAULT_ICON_KEY
from app.core.product_tree import MAX_NODE_DEPTH
from app.features.masters.schemas import (
    ModelCreateRequest,
    ModelUpdateRequest,
    NodeCreateRequest,
    NodeUpdateRequest,
    ParameterOut,
    ProductModelOut,
    ProductNodeOut,
)
from app.models.product import ProductModel, ProductNode
from app.models.product_node_rules import ProductNodeRules
from app.models.technician import TechnicianNode
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
) -> list[ProductNodeOut]:
    """The whole catalogue in one response, nested to whatever depth it has.

    Flat queries assembled in Python rather than a nested eager load or a
    recursive CTE: the catalogue is small (tens of rows), and it feeds the
    technician form, ticket intake and the mobile coverage screen, where a
    second round trip on a field connection costs more than the join would have.

    `vendor_id` narrows it to ONE BRAND'S catalogue: only that vendor's models,
    and only the branches left holding any. A ticket is raised against a specific
    vendor's product, so intake picks the vendor first and everything below it
    follows.

    Technician certification deliberately does NOT pass this — a technician is
    skilled at Televisions whoever made them, and scoping that by brand would
    mean re-certifying everybody each time a vendor is onboarded.

    For a VENDOR caller the parameter is ignored and their own id substituted:
    see below.

    A node whose parent was filtered out is DROPPED, never promoted to a root.
    Pausing *TV* has to take *Android TV* with it; a child that floated up to the
    top level would be offered as a choice its own parent had withdrawn.
    """
    company_id = principal.company_id

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

    if vendor_id is None:
        return roots
    # Filtering to one vendor prunes upward: a branch holding none of that
    # brand's models is not a choice, and offering it would dead-end the picker
    # below it. Unfiltered, every node stays — an empty one is a real part of
    # the master that somebody still has to fill.
    return [root for root in roots if _prune_to_vendor(root)]


def _prune_to_vendor(node: ProductNodeOut) -> bool:
    """Drop branches with no models left. True if this node survives.

    Bottom-up, because a node with no models of its own is still worth keeping
    when something below it has some.
    """
    node.children = [child for child in node.children if _prune_to_vendor(child)]
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
    # presence like the four above: an explicit null must NOT unprice a model,
    # because the ticket columns that copy these are NOT NULL.
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
