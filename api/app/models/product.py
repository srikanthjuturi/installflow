"""The product master: a recursive category tree, with priced products as leaves.

Company-scoped, unlike `regions`. Geography is the same for every tenant; a
product catalogue is not — Company B does not service Company A's range. So both
tables carry `company_id`, and it is denormalised onto products so a list query
is one index probe rather than a walk up the tree.

## The tree is one self-referencing table

`product_nodes` used to be two — `product_categories` and `product_subcategories`
— which fixed the catalogue at exactly three floors and put the floor number in
the DDL. *Electronics → TV → Android TV → 32" Android* is four floors and could
not be stored at all. They are one table now, `parent_id IS NULL` marking a root,
and depth is a value rather than a schema.

The ids did not change when they merged, which is why `tickets`, `product_models`
and `technician_nodes` still point at exactly the rows they always did.

## `ancestor_ids` is what makes the depth free

Every node carries its ancestors, root first, excluding itself. That one array
answers all four questions a tree is otherwise asked recursively:

    inheritance   which ancestors' rules and parameters apply
    eligibility   is a technician certified anywhere above this job
    the breadcrumb  Electronics › TV › Android TV
    is the path live  are all my ancestors still active

None of them needs a recursive CTE, and eligibility — the hottest query in the
product, run for every technician against every open job — stays a single array
membership test.

The array is derived, so three CHECKs guard it: a node cannot be its own parent,
cannot appear among its own ancestors, and its `depth` must equal the array's
length. **`parent_id` is create-only** (`ProductNodeUpdateRequest` has no field
for it), so the array is written once and there is no subtree to rewrite and no
cycle to detect at runtime.

## Two independent notions of "not available", deliberately kept apart

    is_active   Active / Paused. A paused node stays out of new ticket intake
                but remains a valid reference for existing tickets. Intake
                checks the whole `ancestor_ids` chain, not just the node —
                pausing *TV* has to stop *Android TV* too.
    deleted_at  Removed. Soft, because tickets and technician certifications
                reference these rows forever.

Case-insensitive uniqueness is a hand-written `lower()` index in the migration
(the pattern `companies` already uses for slug and GSTIN), partial on
`deleted_at IS NULL` so deleting a node frees its name for reuse. It keys on
`COALESCE(parent_id, <zero uuid>)` rather than on `parent_id`, because Postgres
treats NULLs as DISTINCT in a unique index — without the coalesce, two roots
could both be called "Electronics".

A technician certifies on a MAIN sub-category — the direct child of a root, and
no other level — and that covers everything beneath it. See `CERTIFY_DEPTH` in
`core.product_tree`.
"""

import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKeyConstraint,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.product_tree import MAX_NODE_DEPTH, MAX_PARAMETERS
from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin, SoftDeleteMixin

#: The sentinel that stands in for "no parent" in the unique index. A real UUID
#: is needed because the index is on an expression, and the all-zero one cannot
#: collide with `gen_random_uuid()` output.
NO_PARENT_SENTINEL = "00000000-0000-0000-0000-000000000000"


class ProductNode(Base, IdMixin, AuditMixin, SoftDeleteMixin):
    """One level of the catalogue — Electronics, or TV, or Android TV.

    A root has `parent_id IS NULL`. Everything else hangs off another node, as
    deep as `MAX_NODE_DEPTH` allows.
    """

    __tablename__ = "product_nodes"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: NULL = a root category. The FK is COMPOSITE and self-referencing —
    #: see __table_args__.
    parent_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    #: One of `app.core.icons.PRODUCT_ICON_KEYS`. Validated in the schema layer,
    #: not by a CHECK — the catalogue changes with a deploy, and a CHECK would
    #: make adding an icon a migration.
    #:
    #: Nullable at EVERY level now, including a root, and the API resolves it to
    #: the nearest ancestor that has one (falling back to `DEFAULT_ICON_KEY`).
    #: It used to be NOT NULL on a category and nullable on a subcategory, which
    #: was the same inheritance rule expressed twice and only worked one level
    #: deep.
    icon_key: Mapped[str | None] = mapped_column(String(32), nullable=True)
    #: Distance from the root: 0 for a root, `parent.depth + 1` otherwise.
    #: Denormalised from `ancestor_ids` and CHECKed against its length, because
    #: ordering a tree needs it and `array_length` in an ORDER BY is not free.
    depth: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, server_default=text("0")
    )
    #: Every ancestor, ROOT FIRST, excluding self. See the module docstring —
    #: this is the column the whole design rests on. GIN indexed.
    #:
    #: Assign a NEW list to change it; SQLAlchemy does not track ARRAY mutation
    #: in place, the same trap `image_urls` has.
    ancestor_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(Uuid), nullable=False, server_default=text("'{}'::uuid[]")
    )
    #: The field TEMPLATE for products under this node — `[{"name": "RAM",
    #: "value": "8 GB"}]`, where `value` is an optional default.
    #:
    #: Only meaningful on a leaf, and a CHECK says so: a node that is not the
    #: last sub-category holds no products, so a template on it would describe
    #: nothing.
    #:
    #: It is a TEMPLATE, not inheritance. Creating a product seeds its own
    #: fields from this list; the product then owns what it saved, and editing
    #: this list later does not rewrite products that already exist. The
    #: alternative — merging at read time — was built first and removed: it
    #: needs a precedence rule every reader has to know, and it makes a
    #: catalogue edit silently restate what a technician was told last week.
    #:
    #: Assign a NEW list to change it.
    parameters: Mapped[list[dict]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    #: Is this the level products hang off?
    #:
    #: Ticked, the node takes PRODUCTS and no more sub-categories. Unticked, it
    #: takes SUB-CATEGORIES and no products. Both halves are enforced in
    #: `masters.service`, because each is a question about other rows.
    #:
    #: Stored rather than derived from "does it have products", and that is the
    #: whole reason it exists: an EMPTY node is otherwise ambiguous — unfinished,
    #: or ready for stock? — and the console has to know which buttons to draw
    #: before either has been used. Kept honest by refusing to untick it while
    #: products exist, and to tick it while children do.
    is_leaf: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )

    __table_args__ = (
        CheckConstraint(
            f"depth >= 0 AND depth <= {MAX_NODE_DEPTH}",
            name="depth",
        ),
        # A ROOT never holds products — see `ProductModel`.
        CheckConstraint("NOT is_leaf OR depth >= 1", name="leaf_below_root"),
        # SHAPE only; entries are the schema layer's job — bounding them needs
        # `jsonb_array_elements`, which Postgres refuses inside a CHECK.
        CheckConstraint(
            "jsonb_typeof(parameters) = 'array' "
            f"AND jsonb_array_length(parameters) <= {MAX_PARAMETERS}",
            name="parameters",
        ),
        # A template on a node that holds no products describes nothing.
        CheckConstraint(
            "is_leaf OR jsonb_array_length(parameters) = 0",
            name="template_only_on_leaf",
        ),
        # A root has no parent; nothing else may name itself.
        CheckConstraint(
            "parent_id IS NULL OR parent_id <> id",
            name="parent_not_self",
        ),
        # The composite FK stops a node pointing at another COMPANY's parent. It
        # cannot stop a cycle, because every row in one would satisfy it.
        CheckConstraint(
            "NOT (id = ANY(ancestor_ids))",
            name="no_cycle",
        ),
        # The one that catches a bug in the writer rather than a bad request:
        # if `ancestor_ids` is ever built wrong, eligibility breaks SILENTLY —
        # jobs simply stop being offered, with nothing on any screen to explain
        # it. Length is the half of correctness SQL can check cheaply.
        CheckConstraint(
            "depth = coalesce(array_length(ancestor_ids, 1), 0)",
            name="depth_matches_ancestors",
        ),
        Index("ix_product_nodes_parent_id", "parent_id"),
        Index("ix_product_nodes_company_id", "company_id"),
        # Covers the self composite FK below — deleting a node would otherwise
        # scan every node in the database, not just this company's.
        Index("ix_product_nodes_company_parent", "company_id", "parent_id"),
        # What every ancestor test probes. GIN because the predicate is
        # `<@` / `= ANY(...)` on an array, which btree cannot serve.
        Index(
            "ix_product_nodes_ancestor_ids",
            "ancestor_ids",
            postgresql_using="gin",
        ),
        # What a child's, a product's, a ticket's and a certification's composite
        # FK all point at. TOTAL, not partial — a partial index cannot be a
        # foreign key target (hard rule 6).
        UniqueConstraint("company_id", "id", name="uq_product_nodes_company_id_id"),
        # Composite AND self-referencing: the pair has to match, so a node under
        # another company's parent cannot be written at all — not by a race, not
        # by a future refactor that forgets the check.
        ForeignKeyConstraint(
            ["company_id", "parent_id"],
            ["product_nodes.company_id", "product_nodes.id"],
            name="fk_product_nodes_company_parent",
            ondelete="CASCADE",
        ),
    )


class ProductModel(Base, IdMixin, AuditMixin, SoftDeleteMixin):
    """The priced leaf, e.g. 43" 4K UHD. The thing a ticket names.

    Deliberately NOT a node. A product has an owning brand, photos, service
    types, a warranty and two prices; a category has none of those. Folding them
    into one table would mean seven nullable columns policed by a CHECK — a table
    lying about its own shape — and would move `tickets.model_id`, four
    eligibility tests and both clients' DTOs for no gain.

    It hangs off a node whose **`is_leaf` is set**, enforced in `create_model`.
    That node is always at depth >= 1 (a CHECK on the other table says so),
    which matches what a model always needed — a subcategory — and is what keeps
    `TicketOut.categoryName` (the root) and `.subcategoryName` (the node's own
    name) from collapsing to the same string on every ticket.

    `image_urls` holds http(s) URLs into blob storage and the schema layer
    rejects `data:` — both consoles can produce base64 from a crop, and letting
    one in would put tens of kilobytes into every list response.
    """

    __tablename__ = "product_models"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: The node this product sits under. Renamed from `subcategory_id` when the
    #: tree merged; the values never changed. The FK is COMPOSITE — see
    #: __table_args__.
    node_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    #: The brand. Mandatory: a model nobody makes is not a model anybody can be
    #: sent to install. Also a COMPOSITE FK — see __table_args__.
    #:
    #: This is also why a parameter on a product needs no `vendor_id` of its
    #: own: Samsung's "32 inch Android" and LG's are two rows under one node,
    #: each already naming its brand. Storing it twice would let the two
    #: disagree.
    vendor_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    #: What a technician can be sent to do with this model — one or more of
    #: `app.core.service_types.SERVICE_TYPES`, in catalogue order.
    #:
    #: JSONB for the same reasons as `image_urls` below: bounded at three,
    #: always read whole with its model, never queried on its own. Membership
    #: and "at least one" are a CHECK in the migration.
    #:
    #: Assign a NEW list to change it — SQLAlchemy does not track JSONB
    #: mutation in place.
    service_types: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[\"Installation + Demo\"]'::jsonb")
    )
    #: Size or rating — "43 inch", "7 kg", "340 L". Its own column rather than
    #: part of the name, which is where it lives today and where it cannot be
    #: sorted, filtered or shown on its own.
    capacity: Mapped[str | None] = mapped_column(String(64), nullable=True)
    #: What a technician gets asked in front of the unit, and what a later
    #: claim quotes. CHECK 0..240 in the migration.
    warranty_months: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    #: Anything about this product that is not a spec — handling, a known quirk,
    #: what to check before leaving. Free text rather than a parameter, because
    #: it is prose and has no name to inherit under.
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Free-form specs — `[{"name": "RAM", "value": "8 GB"}]`.
    #:
    #: JSONB rather than a child table, for the reason `image_urls` and
    #: `service_types` are: the list is bounded, always read whole with its row
    #: and never queried on its own, so a join would buy nothing.
    #:
    #: On the PRODUCT and nowhere else. A category carried these too in the
    #: first cut, with the inheritance that implied; a spec describes a thing
    #: you can install, and a category is a way of finding one — so there is
    #: nothing above this row to merge with and no precedence rule to learn.
    #:
    #: Assign a NEW list to change it — SQLAlchemy does not track JSONB
    #: mutation in place.
    parameters: Mapped[list[dict]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    #: Up to five photos, ordered — the first is the thumbnail every list draws.
    #: JSONB rather than a child table: the list is bounded, always read whole
    #: with its model and never queried on its own, so a join would buy nothing
    #: and cost a second composite-FK relationship to keep tenant-safe. The
    #: ceiling is enforced in the schema layer, not by a CHECK.
    #:
    #: Assign a NEW list to change it. SQLAlchemy does not track mutation of a
    #: plain JSONB value in place, so `row.image_urls.append(...)` saves nothing.
    image_urls: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    #: What this job is worth, in PAISE — never a float, never a formatted
    #: string. Two amounts because a job has two sides and they are different
    #: numbers: `technician_payout_paise` is what the technician earns for doing
    #: it, `vendor_price_paise` is what the vendor is charged for asking. The
    #: margin between them is the company's, and neither party is ever shown the
    #: other's figure — the masking is in `masters.get_tree` and
    #: `tickets._hydrate`, and the technician's `JobOfferOut` simply has no
    #: vendor-price field to leak.
    #:
    #: Both are NOT NULL and both CHECK `> 0`. A model nobody has priced is one
    #: no ticket can be costed against, and the alternative — nullable, refused
    #: at intake — leaves the Excel importer and the vendor API channel free to
    #: write a priceless row that only fails much later.
    technician_payout_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    vendor_price_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )

    __table_args__ = (
        CheckConstraint(
            "warranty_months IS NULL OR (warranty_months >= 0 AND warranty_months <= 240)",
            name="warranty_months",
        ),
        # `> 0` rather than `>= 0`: a free job is not a cheap job, it is a
        # missing price. Same reading as `ledger_entries.amount_paise`.
        CheckConstraint("technician_payout_paise > 0", name="technician_payout_paise"),
        CheckConstraint("vendor_price_paise > 0", name="vendor_price_paise"),
        CheckConstraint(
            "jsonb_typeof(service_types) = 'array' "
            "AND jsonb_array_length(service_types) >= 1 "
            "AND service_types <@ "
            "'[\"Installation + Demo\", \"Tech Visit\", \"Service\"]'::jsonb",
            name="service_types",
        ),
        # SHAPE only. Bounding each entry means walking the array with
        # `jsonb_array_elements`, a set-returning function, and Postgres refuses
        # a subquery inside a CHECK — the same split `image_urls` already makes.
        CheckConstraint(
            "jsonb_typeof(parameters) = 'array' "
            f"AND jsonb_array_length(parameters) <= {MAX_PARAMETERS}",
            name="parameters",
        ),
        Index("ix_product_models_node_id", "node_id"),
        Index("ix_product_models_company_id", "company_id"),
        Index("ix_product_models_vendor_id", "vendor_id"),
        # One per composite FK below. The single-column pair above serve
        # cross-company lookups; these serve the FK checks, which match on both.
        Index("ix_product_models_company_node", "company_id", "node_id"),
        Index("ix_product_models_company_vendor", "company_id", "vendor_id"),
        # What a ticket's composite FK points at. Added when tickets landed —
        # until then nothing hung off a model, so there was nothing to point.
        UniqueConstraint("company_id", "id", name="uq_product_models_company_id_id"),
        ForeignKeyConstraint(
            ["company_id", "node_id"],
            ["product_nodes.company_id", "product_nodes.id"],
            name="fk_product_models_company_node",
            ondelete="CASCADE",
        ),
        # RESTRICT, not CASCADE: removing a vendor that still brands models must
        # be refused with a message the user can act on, never take the models
        # down with it. Same reasoning as technician_nodes' node side, which
        # refuses to silently decertify somebody.
        ForeignKeyConstraint(
            ["company_id", "vendor_id"],
            ["vendors.company_id", "vendors.id"],
            name="fk_product_models_company_vendor",
            ondelete="RESTRICT",
        ),
    )
