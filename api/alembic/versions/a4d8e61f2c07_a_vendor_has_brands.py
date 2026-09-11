"""A vendor has brands

Until now a product's brand WAS its vendor: `product_models.vendor_id` was
documented as "the brand", the vendor list was "the brand picker", and a
product chip printed the vendor's company name. That stops being true the day a
company sells more than one brand — Crestline Distributors sells Meridian and
Sunview, and "Crestline Distributors" is neither.

  * `vendor_brands` — one vendor's brands. Staff add them on the vendor form,
    approved at once; a vendor adds its own from the portal, and those wait for
    a National Head or an Admin exactly as a vendor-submitted product does —
    the same five approval columns and the same CHECKs.
  * `product_models.brand_id` — the brand a product carries. The FK is
    `(company_id, vendor_id, brand_id) -> vendor_brands(company_id, vendor_id,
    id)`, so a product's brand cannot belong to another vendor: the database
    refuses it, not a service remembering to.
  * `notifications.kind` gains `brand_submitted`, `brand_approved` and
    `brand_rejected` — the product trio's twins.

## The backfill keeps every screen as it was

Every vendor gets ONE approved brand named after itself, and every product —
live or removed, since the column becomes NOT NULL — is given its vendor's.
Nothing reads differently until somebody adds a second brand. The brand of a
removed vendor is born removed too, so it holds no name against a new vendor.
No decision is recorded on those rows: nobody reviewed them, and asserting
otherwise would fake an audit trail (the reasoning `c4e81b90f7a2` gives for the
products it backfilled).

## A model's name is unique per BRAND now, not per category

`uq_product_models_node_name_lower` made a name unique under a node across
every vendor — so Meridian's "43 inch LED" and Sunview's could not both exist in
one category, which multi-brand vendors need on day one. It becomes
`(node_id, brand_id, lower(name))`.

## The downgrade refuses to destroy what people entered

It would have to fold every brand back into its vendor, losing which products
carried which brand and every approval decision. If any brand is anything but
the backfilled "vendor's own name, approved", it stops and says how many — the
shape `c4e81b90f7a2` uses. Two products that share a name under one node (legal
now, illegal before) stop it too, since the old index could not be rebuilt.

Revision ID: a4d8e61f2c07
Revises: f3c9a2d71b58
Create Date: 2026-09-11 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a4d8e61f2c07"
down_revision: Union[str, Sequence[str], None] = "f3c9a2d71b58"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


#: The notification kinds as they stand before this revision. Spelled out
#: rather than imported from the model: a migration must keep describing the
#: database it was written against, even after the model has moved on.
_NOTIFICATIONS = (
    "'escalation', 'ai', 'serial_mismatch', 'force_close', 'slot', "
    "'technician_joined', 'job_started', 'invite_expired', 'assigned', "
    "'no_show', 'product_submitted', 'product_approved', 'product_rejected', "
    "'rescheduled', 'redemption'"
)
_BRAND_KINDS = "'brand_submitted', 'brand_approved', 'brand_rejected'"


def upgrade() -> None:
    op.create_table(
        "vendor_brands",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("vendor_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        # 'pending' as the default fails CLOSED, the call `product_models` made:
        # a writer that forgets produces a brand nobody can file products under
        # and that sits in the approvals queue — somebody noticing, not
        # somebody's catalogue quietly growing.
        sa.Column(
            "approval_status",
            sa.String(length=16),
            server_default=sa.text("'pending'"),
            nullable=False,
        ),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_by", sa.Uuid(), nullable=True),
        sa.Column("rejection_reason", sa.String(length=255), nullable=True),
        # Audit columns last, as everywhere — the mixins are `declared_attr` and
        # sort behind the model's own columns.
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
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
        sa.CheckConstraint(
            "approval_status IN ('pending', 'approved', 'rejected')",
            name=op.f("ck_vendor_brands_approval_status"),
        ),
        sa.CheckConstraint(
            "approval_status <> 'pending' "
            "OR (decided_at IS NULL AND decided_by IS NULL)",
            name=op.f("ck_vendor_brands_pending_has_no_decision"),
        ),
        sa.CheckConstraint(
            "(decided_at IS NULL) = (decided_by IS NULL)",
            name=op.f("ck_vendor_brands_decided_by_with_decided_at"),
        ),
        sa.CheckConstraint(
            "(approval_status = 'rejected') = (rejection_reason IS NOT NULL)",
            name=op.f("ck_vendor_brands_rejection_reason_only_on_rejected"),
        ),
        sa.CheckConstraint(
            "approval_status <> 'pending' OR submitted_at IS NOT NULL",
            name=op.f("ck_vendor_brands_pending_was_submitted"),
        ),
        sa.ForeignKeyConstraint(
            ["company_id"],
            ["companies.id"],
            name=op.f("fk_vendor_brands_company_id_companies"),
            ondelete="CASCADE",
        ),
        # RESTRICT: a vendor is soft-deleted, never hard-deleted, and a hard
        # delete that took its brands would take the products' brands with it.
        sa.ForeignKeyConstraint(
            ["company_id", "vendor_id"],
            ["vendors.company_id", "vendors.id"],
            name=op.f("fk_vendor_brands_company_vendor"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_vendor_brands")),
        # TOTAL, not partial — it is the target of the products' composite FK,
        # and a partial index cannot be one. Its `(company_id, vendor_id)`
        # prefix is also the covering index for the vendor FK above.
        sa.UniqueConstraint(
            "company_id",
            "vendor_id",
            "id",
            name=op.f("uq_vendor_brands_company_vendor_id"),
        ),
    )
    # One brand name per vendor, ignoring case, among the live ones — partial,
    # so a removed brand frees its name. Hand-written: `Index()` cannot say
    # `lower()` with a WHERE, and autogenerate will keep offering to drop it.
    op.execute(
        "CREATE UNIQUE INDEX uq_vendor_brands_vendor_name_lower "
        "ON vendor_brands (company_id, vendor_id, lower(name)) "
        "WHERE deleted_at IS NULL"
    )

    # ── the backfill: each vendor's own name, approved ───────────────────────
    op.execute(
        """
        INSERT INTO vendor_brands
            (company_id, vendor_id, name, approval_status, created_by, deleted_at)
        SELECT v.company_id, v.id, left(v.name, 120), 'approved',
               v.created_by, v.deleted_at
        FROM vendors v
        """
    )

    op.add_column("product_models", sa.Column("brand_id", sa.Uuid(), nullable=True))
    # Exactly one brand per vendor exists at this moment, so this is unambiguous.
    op.execute(
        """
        UPDATE product_models pm
        SET brand_id = vb.id
        FROM vendor_brands vb
        WHERE vb.company_id = pm.company_id
          AND vb.vendor_id = pm.vendor_id
        """
    )
    op.alter_column("product_models", "brand_id", nullable=False)
    op.create_foreign_key(
        "fk_product_models_company_vendor_brand",
        "product_models",
        "vendor_brands",
        ["company_id", "vendor_id", "brand_id"],
        ["company_id", "vendor_id", "id"],
        ondelete="RESTRICT",
    )
    # The covering index for that FK, in its column order.
    op.create_index(
        "ix_product_models_company_vendor_brand",
        "product_models",
        ["company_id", "vendor_id", "brand_id"],
    )

    # ── a model's name is unique per brand ───────────────────────────────────
    op.execute("DROP INDEX IF EXISTS uq_product_models_node_name_lower")
    op.execute(
        "CREATE UNIQUE INDEX uq_product_models_node_brand_name_lower "
        "ON product_models (node_id, brand_id, lower(name)) "
        "WHERE deleted_at IS NULL"
    )

    # ── three notification kinds ─────────────────────────────────────────────
    op.drop_constraint("kind", "notifications", type_="check")
    op.create_check_constraint(
        "kind", "notifications", f"kind IN ({_NOTIFICATIONS}, {_BRAND_KINDS})"
    )


def downgrade() -> None:
    bind = op.get_bind()

    # Refuse rather than destroy. See the module docstring.
    entered = bind.execute(
        sa.text(
            """
            SELECT count(*) FROM vendor_brands vb
            JOIN vendors v ON v.id = vb.vendor_id AND v.company_id = vb.company_id
            WHERE vb.deleted_at IS NULL
              AND (vb.approval_status <> 'approved'
                   OR lower(vb.name) <> lower(left(v.name, 120)))
            """
        )
    ).scalar()
    if entered:
        raise RuntimeError(
            f"{entered} brand(s) were entered or decided after this migration. "
            "Downgrading would fold them back into their vendors and lose them."
        )
    clashes = bind.execute(
        sa.text(
            """
            SELECT count(*) FROM (
                SELECT 1 FROM product_models
                WHERE deleted_at IS NULL
                GROUP BY node_id, lower(name)
                HAVING count(*) > 1
            ) AS d
            """
        )
    ).scalar()
    if clashes:
        raise RuntimeError(
            f"{clashes} product name(s) are shared by two brands in one category, "
            "which the old per-category unique index cannot hold. Rename them first."
        )

    op.execute(
        "DELETE FROM notifications "
        f"WHERE kind IN ({_BRAND_KINDS})"
    )
    op.drop_constraint("kind", "notifications", type_="check")
    op.create_check_constraint("kind", "notifications", f"kind IN ({_NOTIFICATIONS})")

    op.execute("DROP INDEX IF EXISTS uq_product_models_node_brand_name_lower")
    op.execute(
        "CREATE UNIQUE INDEX uq_product_models_node_name_lower "
        "ON product_models (node_id, lower(name)) WHERE deleted_at IS NULL"
    )
    op.drop_index("ix_product_models_company_vendor_brand", table_name="product_models")
    op.drop_constraint(
        "fk_product_models_company_vendor_brand", "product_models", type_="foreignkey"
    )
    op.drop_column("product_models", "brand_id")
    op.execute("DROP INDEX IF EXISTS uq_vendor_brands_vendor_name_lower")
    op.drop_table("vendor_brands")
