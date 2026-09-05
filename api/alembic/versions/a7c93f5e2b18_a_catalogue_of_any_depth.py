"""A catalogue of any depth, with its own parameters and its own rules.

Three limits go at once.

**The tree was exactly three floors, and the floor number was in the DDL.**
`product_categories` → `product_subcategories` → `product_models`, two composite
foreign keys encoding the shape. *Electronics → TV → Android TV → 32" Android* is
four floors and could not be stored. `product_subcategories` becomes
`product_nodes`, self-referencing, and the categories move into it as roots.

**A category could not say where the products go.** `is_leaf` marks the level
that holds them: tick it and the node takes products and no more sub-categories,
leave it and the node takes sub-categories and no products. Derivable in
principle ("it is a leaf if it has products") and stored anyway, because an
EMPTY node is otherwise ambiguous — unfinished, or ready for stock? — and the
console has to know which two buttons to draw before either is used.

**Rules were one row per company.** `product_node_rules` holds a node's
overrides — every column nullable, null meaning inherit — and a ticket now
STAMPS its resolved set, the way it already stamps its two prices.

**Nothing described a product.** `product_models.parameters` is a JSONB array of
name/value pairs, plus `notes` for the prose that does not fit one. (The field
TEMPLATE on the last sub-category that those start from arrived in
`b8d41e07c592`, once this one was already applied.)

## Why this moves no data

Every UUID is preserved. `product_subcategories` is RENAMED rather than rebuilt,
so its rows keep their ids and every foreign key pointing at them keeps
resolving; the `product_categories` rows are INSERTed with their own ids intact,
so `category_id` — renamed to `parent_id` in place — is already correct for every
existing subcategory. There is nothing to remap, and the three columns that
referenced the old tables (`product_models.subcategory_id`,
`tickets.subcategory_id`, `technician_subcategories.subcategory_id`) are pure
renames.

That is also why `ancestor_ids` backfills to one element: everything that was a
subcategory sits at depth 1 under the category it always had.

## Order matters twice

The categories must be INSERTed **before** the self-referencing foreign key is
added, or every existing subcategory momentarily points at a row that is not in
the table yet. And the old FK to `product_categories` must be dropped **before**
the insert, or the rows arrive as children of themselves.

## Downgrade REFUSES rather than deletes

`product_categories` / `product_subcategories` cannot represent depth > 1, and
`tickets` holds RESTRICT foreign keys, so there is no honest way to collapse a
deep tree. It raises instead, naming the nodes in the way. Run the round trip
BEFORE creating deep data (hard rule 6) and it passes; run it after and you are
told why not, which is better than silently discarding a catalogue.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "a7c93f5e2b18"
down_revision: Union[str, Sequence[str], None] = "c1a7f30d92b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


#: Stands in for "no parent" in the sibling-name unique index.
#:
#: Postgres treats NULLs as DISTINCT in a unique index, so
#: `(company_id, parent_id, lower(name))` would let two ROOTS both be called
#: "Electronics" — silently losing a constraint `product_categories` had.
#: `NULLS NOT DISTINCT` would also fix it and needs PG 15+; a sentinel needs
#: nothing, and the all-zero UUID cannot collide with `gen_random_uuid()`.
NO_PARENT = "00000000-0000-0000-0000-000000000000"

#: `core.rules.DEFAULTS`, spelled out rather than imported.
#:
#: A migration is a historical record and must keep producing the same rows
#: forever; importing the live constant would make this backfill change meaning
#: the next time somebody tunes a default. Only reached by a ticket whose
#: company has no `company_rules` row, which the previous migration made
#: impossible — it is the belt to that braces.
DEFAULT_RULES_JSON = """{
  "cancel_penalties_paise": [30000, 50000, 80000, 120000],
  "cancel_penalty_cap_paise": 500000,
  "bonus_bands_paise": [20000, 40000, 60000, 80000],
  "ai_confidence_threshold": 70,
  "sla_warn_at_pct": 25,
  "slot_silence_hours": 6,
  "escalate_hours_before_slot": 4,
  "force_close_hours": 48,
  "renotify_grace_minutes": 30,
  "slot_reminder_minutes": 60,
  "customer_notice_minutes": 60,
  "geo_radius_m": 1000
}"""

#: Every rule a ticket carries. The cap is here too: a snapshot is what the job
#: runs on, and `_band_for` reads the cap from the company only because it spans
#: jobs — a reader should still find the number it was quoted under.
SNAPSHOT_KEYS = (
    "cancel_penalties_paise",
    "cancel_penalty_cap_paise",
    "bonus_bands_paise",
    "ai_confidence_threshold",
    "sla_warn_at_pct",
    "slot_silence_hours",
    "escalate_hours_before_slot",
    "force_close_hours",
    "renotify_grace_minutes",
    "slot_reminder_minutes",
    "customer_notice_minutes",
    "geo_radius_m",
)

#: A node's rule overrides. All nullable — null is how "inherit" is spelled.
#: `cancel_penalty_cap_paise` is deliberately absent: it caps a TECHNICIAN's
#: month across every job they took, so it cannot have an answer per product.
NODE_RULE_INTS = (
    ("ai_confidence_threshold", 50, 95),
    ("sla_warn_at_pct", 1, 99),
    ("slot_silence_hours", 1, 72),
    ("escalate_hours_before_slot", 1, 48),
    ("force_close_hours", 1, 240),
    ("renotify_grace_minutes", 5, 720),
    ("slot_reminder_minutes", 5, 1440),
    ("customer_notice_minutes", 5, 1440),
    ("geo_radius_m", 50, 5000),
)

#: Entries in one row's `parameters`. Mirrors `core.product_tree.MAX_PARAMETERS`.
MAX_PARAMETERS = 20
#: Mirrors `core.product_tree.MAX_NODE_DEPTH`.
MAX_NODE_DEPTH = 5


def upgrade() -> None:
    # ── 1. the tree becomes one self-referencing table ────────────────────────
    #
    # The old FK goes FIRST: the category rows are about to arrive in this same
    # table, and while the constraint stands they would have to satisfy it
    # against themselves.
    op.drop_constraint(
        "fk_product_subcategories_company_category",
        "product_subcategories",
        type_="foreignkey",
    )
    op.execute("ALTER TABLE product_subcategories RENAME TO product_nodes")
    op.alter_column("product_nodes", "category_id", new_column_name="parent_id")
    op.alter_column("product_nodes", "parent_id", nullable=True)

    # Renaming a table leaves every constraint and index carrying its old name.
    for old, new in (
        ("pk_product_subcategories", "pk_product_nodes"),
        ("uq_product_subcategories_company_id_id", "uq_product_nodes_company_id_id"),
        (
            "fk_product_subcategories_company_id_companies",
            "fk_product_nodes_company_id_companies",
        ),
    ):
        op.execute(f"ALTER TABLE product_nodes RENAME CONSTRAINT {old} TO {new}")
    for old, new in (
        ("ix_product_subcategories_category_id", "ix_product_nodes_parent_id"),
        ("ix_product_subcategories_company_id", "ix_product_nodes_company_id"),
        ("ix_product_subcategories_company_category", "ix_product_nodes_company_parent"),
    ):
        op.execute(f"ALTER INDEX {old} RENAME TO {new}")
    # Replaced below by one that also covers roots — see NO_PARENT.
    op.execute("DROP INDEX IF EXISTS uq_product_subcategories_category_name_lower")

    op.add_column(
        "product_nodes",
        sa.Column(
            "depth", sa.SmallInteger(), server_default=sa.text("0"), nullable=False
        ),
    )
    op.add_column(
        "product_nodes",
        sa.Column(
            "ancestor_ids",
            postgresql.ARRAY(sa.Uuid()),
            server_default=sa.text("'{}'::uuid[]"),
            nullable=False,
        ),
    )
    # Backfilled in step 4, once `product_models` names its parent `node_id`.
    op.add_column(
        "product_nodes",
        sa.Column(
            "is_leaf", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
    )

    # ── 2. the categories move in, ids intact ─────────────────────────────────
    #
    # Columns listed explicitly. `SELECT *` would depend on two tables agreeing
    # on column ORDER, which the audit-column mixins make a non-obvious property.
    op.execute(
        """
        INSERT INTO product_nodes (
            id, company_id, parent_id, name, icon_key, depth, ancestor_ids,
            sort_order, is_active,
            created_at, updated_at, created_by, updated_by, deleted_at
        )
        SELECT
            id, company_id, NULL, name, icon_key, 0, '{}'::uuid[],
            sort_order, is_active,
            created_at, updated_at, created_by, updated_by, deleted_at
        FROM product_categories
        """
    )
    # Everything that WAS a subcategory sits at depth 1, under the category it
    # always had — which `parent_id` already names.
    op.execute(
        "UPDATE product_nodes SET depth = 1, ancestor_ids = ARRAY[parent_id] "
        "WHERE parent_id IS NOT NULL"
    )

    # ── 3. the self link, and the CHECKs that keep the array honest ───────────
    op.create_foreign_key(
        "fk_product_nodes_company_parent",
        "product_nodes",
        "product_nodes",
        ["company_id", "parent_id"],
        ["company_id", "id"],
        ondelete="CASCADE",
    )
    op.create_check_constraint(
        "depth", "product_nodes", f"depth >= 0 AND depth <= {MAX_NODE_DEPTH}"
    )
    op.create_check_constraint(
        "parent_not_self", "product_nodes", "parent_id IS NULL OR parent_id <> id"
    )
    # The composite FK stops a node pointing at another COMPANY's parent. It
    # cannot stop a cycle, because every row in one would satisfy it.
    op.create_check_constraint(
        "no_cycle", "product_nodes", "NOT (id = ANY(ancestor_ids))"
    )
    # Catches a bug in the WRITER rather than a bad request. If `ancestor_ids`
    # is ever built wrong, eligibility breaks silently — jobs simply stop being
    # offered, with nothing on any screen to explain it.
    op.create_check_constraint(
        "depth_matches_ancestors",
        "product_nodes",
        "depth = coalesce(array_length(ancestor_ids, 1), 0)",
    )
    # A ROOT never holds products. That was true before this migration (a model
    # needed a subcategory) and it is what keeps `TicketOut.categoryName` — the
    # root — and `.subcategoryName` — the node — from being the same string on
    # every ticket, which both clients render side by side.
    op.create_check_constraint(
        "leaf_below_root", "product_nodes", "NOT is_leaf OR depth >= 1"
    )

    op.execute(
        "CREATE INDEX ix_product_nodes_ancestor_ids "
        "ON product_nodes USING GIN (ancestor_ids)"
    )
    # Unique among SIBLINGS, and among ROOTS — see NO_PARENT for why the
    # coalesce. Hand-written, so `--autogenerate` will want to drop it every
    # time: delete that drop (hard rule 8).
    op.execute(
        "CREATE UNIQUE INDEX uq_product_nodes_parent_name_lower ON product_nodes "
        f"(company_id, COALESCE(parent_id, '{NO_PARENT}'::uuid), lower(name)) "
        "WHERE deleted_at IS NULL"
    )

    op.drop_index("ix_product_categories_company_id", table_name="product_categories")
    op.drop_table("product_categories")

    # ── 4. product_models: rename the parent, add notes and parameters ────────
    op.alter_column("product_models", "subcategory_id", new_column_name="node_id")
    op.execute(
        "ALTER TABLE product_models RENAME CONSTRAINT "
        "fk_product_models_company_subcategory TO fk_product_models_company_node"
    )
    op.execute(
        "ALTER INDEX ix_product_models_subcategory_id "
        "RENAME TO ix_product_models_node_id"
    )
    op.execute(
        "ALTER INDEX ix_product_models_company_subcategory "
        "RENAME TO ix_product_models_company_node"
    )
    op.execute("DROP INDEX IF EXISTS uq_product_models_subcategory_name_lower")
    op.execute(
        "CREATE UNIQUE INDEX uq_product_models_node_name_lower ON product_models "
        "(node_id, lower(name)) WHERE deleted_at IS NULL"
    )
    # Every node that already holds a product IS the level products go on —
    # which is exactly what the flag records. Backfilled from the data rather
    # than defaulted, so an existing catalogue keeps working without anybody
    # re-ticking a hundred rows.
    op.execute(
        """
        UPDATE product_nodes n SET is_leaf = true
         WHERE EXISTS (
               SELECT 1 FROM product_models m
                WHERE m.node_id = n.id AND m.deleted_at IS NULL)
        """
    )

    op.add_column("product_models", sa.Column("notes", sa.Text(), nullable=True))
    op.add_column(
        "product_models",
        sa.Column(
            "parameters",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )
    # SHAPE only. Bounding each entry means walking the array with
    # `jsonb_array_elements`, a set-returning function, and Postgres refuses a
    # subquery inside a CHECK — the same split `image_urls` already makes.
    op.create_check_constraint(
        "parameters",
        "product_models",
        f"jsonb_typeof(parameters) = 'array' "
        f"AND jsonb_array_length(parameters) <= {MAX_PARAMETERS}",
    )

    # ── 5. certifications name a node ─────────────────────────────────────────
    op.execute("ALTER TABLE technician_subcategories RENAME TO technician_nodes")
    op.alter_column("technician_nodes", "subcategory_id", new_column_name="node_id")
    for old, new in (
        ("pk_technician_subcategories", "pk_technician_nodes"),
        ("uq_technician_subcategory", "uq_technician_node"),
        (
            "fk_technician_subcategories_company_technician",
            "fk_technician_nodes_company_technician",
        ),
        (
            "fk_technician_subcategories_company_subcategory",
            "fk_technician_nodes_company_node",
        ),
        (
            "fk_technician_subcategories_company_id_companies",
            "fk_technician_nodes_company_id_companies",
        ),
    ):
        op.execute(f"ALTER TABLE technician_nodes RENAME CONSTRAINT {old} TO {new}")
    for old, new in (
        ("ix_technician_subcategories_subcategory_id", "ix_technician_nodes_node_id"),
        (
            "ix_technician_subcategories_company_technician",
            "ix_technician_nodes_company_technician",
        ),
        (
            "ix_technician_subcategories_company_subcategory",
            "ix_technician_nodes_company_node",
        ),
    ):
        op.execute(f"ALTER INDEX {old} RENAME TO {new}")

    # ── 6. the ticket's stamps ────────────────────────────────────────────────
    op.alter_column("tickets", "subcategory_id", new_column_name="node_id")
    op.execute(
        "ALTER TABLE tickets RENAME CONSTRAINT "
        "fk_tickets_company_subcategory TO fk_tickets_company_node"
    )
    op.execute(
        "ALTER INDEX ix_tickets_company_subcategory RENAME TO ix_tickets_company_node"
    )

    # Nullable, backfill, tighten — the three-step `e6a3f91c72b8` used for the
    # price columns, because the development database holds test tickets even
    # though production holds no jobs.
    op.add_column(
        "tickets", sa.Column("node_path_ids", postgresql.ARRAY(sa.Uuid()), nullable=True)
    )
    op.add_column(
        "tickets",
        sa.Column("rules_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.execute(
        """
        UPDATE tickets t
           SET node_path_ids = n.ancestor_ids || ARRAY[n.id]
          FROM product_nodes n
         WHERE n.id = t.node_id
        """
    )
    build = ", ".join(f"'{key}', r.{key}" for key in SNAPSHOT_KEYS)
    op.execute(
        f"""
        UPDATE tickets t
           SET rules_snapshot = jsonb_build_object({build})
          FROM company_rules r
         WHERE r.company_id = t.company_id
        """
    )
    # A company with no rules row cannot exist any more, but a ticket with a
    # NULL snapshot would fail the NOT NULL below and take the whole migration
    # with it. Cheaper to be sure than to debug it on production.
    op.execute(
        "UPDATE tickets SET rules_snapshot = '"
        + DEFAULT_RULES_JSON.replace("\n", " ")
        + "'::jsonb WHERE rules_snapshot IS NULL"
    )
    op.alter_column("tickets", "node_path_ids", nullable=False)
    op.alter_column("tickets", "rules_snapshot", nullable=False)

    # ── 7. per-category rule overrides ────────────────────────────────────────
    op.create_table(
        "product_node_rules",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("node_id", sa.Uuid(), nullable=False),
        sa.Column(
            "cancel_penalties_paise",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "bonus_bands_paise", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        *(sa.Column(name, sa.Integer(), nullable=True) for name, _, _ in NODE_RULE_INTS),
        # Audit columns LAST, matching every other table (hard rule 6).
        sa.Column(
            "id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(
            ["company_id", "node_id"],
            ["product_nodes.company_id", "product_nodes.id"],
            name="fk_product_node_rules_company_node",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["company_id"],
            ["companies.id"],
            name=op.f("fk_product_node_rules_company_id_companies"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_product_node_rules")),
        # Covers `(company_id, node_id)` as a prefix, which is exactly the
        # composite FK's column list — so no separate index (hard rule 6's other
        # half: do not add one a unique already covers).
        sa.UniqueConstraint("company_id", "node_id", name="uq_product_node_rules_node"),
    )
    for name, low, high in NODE_RULE_INTS:
        op.create_check_constraint(
            name,
            "product_node_rules",
            f"{name} IS NULL OR ({name} >= {low} AND {name} <= {high})",
        )
    for name, count in (("cancel_penalties_paise", 4), ("bonus_bands_paise", 4)):
        op.create_check_constraint(
            name,
            "product_node_rules",
            f"{name} IS NULL OR (jsonb_typeof({name}) = 'array' "
            f"AND jsonb_array_length({name}) = {count})",
        )


def downgrade() -> None:
    # Refuse rather than discard. Two tables cannot hold a tree, and `tickets`
    # holds RESTRICT foreign keys at both ends — there is no collapse that is
    # not data loss somebody would discover much later.
    deep = op.get_bind().scalar(
        sa.text("SELECT count(*) FROM product_nodes WHERE depth > 1")
    )
    if deep:
        raise RuntimeError(
            f"{deep} categor{'y is' if deep == 1 else 'ies are'} more than two "
            "levels deep, which the three-table schema cannot represent. Remove "
            "them before downgrading. (Run the migration round trip BEFORE "
            "creating deep data.)"
        )

    op.drop_table("product_node_rules")

    op.alter_column("tickets", "node_path_ids", nullable=True)
    op.drop_column("tickets", "rules_snapshot")
    op.drop_column("tickets", "node_path_ids")
    op.execute(
        "ALTER INDEX ix_tickets_company_node RENAME TO ix_tickets_company_subcategory"
    )
    op.execute(
        "ALTER TABLE tickets RENAME CONSTRAINT "
        "fk_tickets_company_node TO fk_tickets_company_subcategory"
    )
    op.alter_column("tickets", "node_id", new_column_name="subcategory_id")

    for new, old in (
        ("ix_technician_nodes_node_id", "ix_technician_subcategories_subcategory_id"),
        (
            "ix_technician_nodes_company_technician",
            "ix_technician_subcategories_company_technician",
        ),
        (
            "ix_technician_nodes_company_node",
            "ix_technician_subcategories_company_subcategory",
        ),
    ):
        op.execute(f"ALTER INDEX {new} RENAME TO {old}")
    for new, old in (
        ("pk_technician_nodes", "pk_technician_subcategories"),
        ("uq_technician_node", "uq_technician_subcategory"),
        (
            "fk_technician_nodes_company_technician",
            "fk_technician_subcategories_company_technician",
        ),
        (
            "fk_technician_nodes_company_node",
            "fk_technician_subcategories_company_subcategory",
        ),
        (
            "fk_technician_nodes_company_id_companies",
            "fk_technician_subcategories_company_id_companies",
        ),
    ):
        op.execute(f"ALTER TABLE technician_nodes RENAME CONSTRAINT {new} TO {old}")
    op.alter_column("technician_nodes", "node_id", new_column_name="subcategory_id")
    op.execute("ALTER TABLE technician_nodes RENAME TO technician_subcategories")

    # BARE name, not `ck_product_models_parameters`. The naming convention is
    # applied on the way OUT too, so passing the prefix produces
    # `ck_product_models_ck_product_models_parameters` — the same trap
    # `e6a3f91c72b8` documented for `create_check_constraint`, and it bites
    # identically here.
    op.drop_constraint("parameters", "product_models", type_="check")
    op.drop_column("product_models", "parameters")
    op.drop_column("product_models", "notes")
    op.execute("DROP INDEX IF EXISTS uq_product_models_node_name_lower")
    op.execute(
        "ALTER INDEX ix_product_models_company_node "
        "RENAME TO ix_product_models_company_subcategory"
    )
    op.execute(
        "ALTER INDEX ix_product_models_node_id "
        "RENAME TO ix_product_models_subcategory_id"
    )
    op.execute(
        "ALTER TABLE product_models RENAME CONSTRAINT "
        "fk_product_models_company_node TO fk_product_models_company_subcategory"
    )
    op.alter_column("product_models", "node_id", new_column_name="subcategory_id")
    # AFTER the rename — the index names the column, so it cannot be built
    # while the column is still called `node_id`.
    op.execute(
        "CREATE UNIQUE INDEX uq_product_models_subcategory_name_lower "
        "ON product_models (subcategory_id, lower(name)) WHERE deleted_at IS NULL"
    )

    # Rebuild `product_categories` from the roots, ids intact.
    op.create_table(
        "product_categories",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("icon_key", sa.String(length=32), nullable=False),
        sa.Column(
            "sort_order", sa.Integer(), server_default=sa.text("0"), nullable=False
        ),
        sa.Column(
            "is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        sa.Column(
            "id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["company_id"],
            ["companies.id"],
            name=op.f("fk_product_categories_company_id_companies"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_product_categories")),
        sa.UniqueConstraint(
            "company_id", "id", name="uq_product_categories_company_id_id"
        ),
    )
    op.create_index(
        "ix_product_categories_company_id", "product_categories", ["company_id"]
    )
    op.execute(
        """
        INSERT INTO product_categories (
            id, company_id, name, icon_key, sort_order, is_active,
            created_at, updated_at, created_by, updated_by, deleted_at
        )
        SELECT id, company_id, name, COALESCE(icon_key, 'package'), sort_order,
               is_active, created_at, updated_at, created_by, updated_by, deleted_at
        FROM product_nodes WHERE parent_id IS NULL
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_product_categories_company_name_lower "
        "ON product_categories (company_id, lower(name)) WHERE deleted_at IS NULL"
    )
    # ⚠ The self FK goes FIRST, and this ordering is load-bearing.
    #
    # It is `ON DELETE CASCADE` and it points at this same table, so deleting
    # the roots while it stands does not delete the roots — it deletes the whole
    # TREE, silently and in one statement. It cost a real row before the round
    # trip was checked for row counts rather than just for errors.
    op.drop_constraint(
        "fk_product_nodes_company_parent", "product_nodes", type_="foreignkey"
    )
    op.execute("DELETE FROM product_nodes WHERE parent_id IS NULL")

    op.execute("DROP INDEX IF EXISTS uq_product_nodes_parent_name_lower")
    op.drop_index("ix_product_nodes_ancestor_ids", table_name="product_nodes")
    for name in (
        "leaf_below_root",
        "depth_matches_ancestors",
        "no_cycle",
        "parent_not_self",
        "depth",
    ):
        # Bare names — see the note on `product_models` above.
        op.drop_constraint(name, "product_nodes", type_="check")
    op.drop_column("product_nodes", "is_leaf")
    op.drop_column("product_nodes", "ancestor_ids")
    op.drop_column("product_nodes", "depth")

    for new, old in (
        ("ix_product_nodes_company_parent", "ix_product_subcategories_company_category"),
        ("ix_product_nodes_company_id", "ix_product_subcategories_company_id"),
        ("ix_product_nodes_parent_id", "ix_product_subcategories_category_id"),
    ):
        op.execute(f"ALTER INDEX {new} RENAME TO {old}")
    for new, old in (
        ("pk_product_nodes", "pk_product_subcategories"),
        ("uq_product_nodes_company_id_id", "uq_product_subcategories_company_id_id"),
        (
            "fk_product_nodes_company_id_companies",
            "fk_product_subcategories_company_id_companies",
        ),
    ):
        op.execute(f"ALTER TABLE product_nodes RENAME CONSTRAINT {new} TO {old}")
    op.alter_column("product_nodes", "parent_id", nullable=False)
    op.alter_column("product_nodes", "parent_id", new_column_name="category_id")
    op.execute("ALTER TABLE product_nodes RENAME TO product_subcategories")
    op.create_foreign_key(
        "fk_product_subcategories_company_category",
        "product_subcategories",
        "product_categories",
        ["company_id", "category_id"],
        ["company_id", "id"],
        ondelete="CASCADE",
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_product_subcategories_category_name_lower "
        "ON product_subcategories (category_id, lower(name)) WHERE deleted_at IS NULL"
    )
