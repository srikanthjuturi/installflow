"""Four ticket-intake changes: high priority, a second phone, where it was
bought, and Uninstall.

  * **A2** — `tickets.is_high_priority`, NOT NULL default false. A flag for
    the board; nothing downstream reads it.
  * **A6** — `tickets.customer_alt_phone`, nullable, same E.164 shape as
    `customer_phone`.
  * **A7** — a new master, `purchase_platforms` (company-scoped: Amazon,
    Flipkart, the company's own site), plus `tickets.purchase_mode`
    (`online`/`offline`, default `offline`) and `tickets.purchase_platform_id`
    — a COMPOSITE FK into the new table, RESTRICT, allowed only when the mode
    is online (`ck_tickets_purchase_platform_requires_online`).
  * **A5** — `Uninstall` joins `service_type` (`tickets`) and `service_types`
    (`product_models`).

## `description_required` has to move with A5, not just `service_type`

`ck_tickets_description_required` read `(service_type = 'Installation + Demo')
= (description IS NULL)` — correct only because `service_type` held exactly
three values and "not Installation + Demo" therefore meant "Tech Visit or
Service". Adding `Uninstall` beside `Installation + Demo` in the
no-description camp breaks that equivalence: left unchanged, the CHECK would
have started demanding a description on every Uninstall ticket, silently
disagreeing with `TicketCreateRequest._check` (which refuses one). It is
rewritten here keyed on the REQUIRES-a-description set directly —
`(service_type IN ('Tech Visit', 'Service')) = (description IS NOT NULL)` —
so the next addition to either camp needs no second migration to stay correct.

## The hand-written pieces autogenerate cannot see

`uq_purchase_platforms_company_name_lower` is a functional `lower()` partial
index, like `uq_vendor_brands_vendor_name_lower` beside it — `Index()` cannot
express `lower()` with a `WHERE`, and `--autogenerate` will keep offering to
drop it on every future revision. Delete that drop, the same trap
`uq_tickets_vendor_external_ref`, `uq_companies_gst_lower`,
`uq_companies_slug_lower` and `uq_users_email_lower` already document.

## The downgrade refuses rather than destroys

Three independent guards, each for the data that would be lost silently:

  * any `tickets.service_type = 'Uninstall'` row, or any `product_models` row
    declaring it — re-narrowing either CHECK would refuse to even run with
    that data in place, so this fails with a clear reason instead of a bare
    `IntegrityError`.
  * any ticket naming a purchase platform — dropping the column would lose
    which one, and the composite FK would need to go first in any case.
  * any ticket carrying a high-priority flag or a second phone number —
    neither is reconstructible once the column is gone.

Revision ID: 62cb776c943d
Revises: f3b9d1a6c845
Create Date: 2026-10-29
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "62cb776c943d"
down_revision: Union[str, Sequence[str], None] = "f3b9d1a6c845"  # re-point to the live head if the chain moved - never branch
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── A7: the new master ──────────────────────────────────────────────────
    op.create_table(
        "purchase_platforms",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column(
            "is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        # Audit columns last, as everywhere — the mixins are `declared_attr`
        # and sort behind the model's own columns.
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
        sa.ForeignKeyConstraint(
            ["company_id"],
            ["companies.id"],
            name=op.f("fk_purchase_platforms_company_id_companies"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_purchase_platforms")),
        # What a ticket's composite FK points at. TOTAL, not partial — a
        # partial index cannot be a foreign key target.
        sa.UniqueConstraint(
            "company_id", "id", name=op.f("uq_purchase_platforms_company_id_id")
        ),
    )
    # The covering index for the company_id FK above.
    op.create_index(
        "ix_purchase_platforms_company_id", "purchase_platforms", ["company_id"]
    )
    # One platform name per company, ignoring case, among the live ones —
    # partial, so a retired platform frees its name. Hand-written: see the
    # module docstring.
    op.execute(
        "CREATE UNIQUE INDEX uq_purchase_platforms_company_name_lower "
        "ON purchase_platforms (company_id, lower(name)) "
        "WHERE deleted_at IS NULL"
    )

    # ── A5: Uninstall joins the service-type vocabulary ─────────────────────
    op.drop_constraint("service_type", "tickets", type_="check")
    op.create_check_constraint(
        "service_type",
        "tickets",
        "service_type IN ('Installation + Demo', 'Tech Visit', 'Service', "
        "'Uninstall')",
    )
    # Generalised in the same breath — see the module docstring for why this
    # is not optional once `service_type` holds a fourth value.
    op.drop_constraint("description_required", "tickets", type_="check")
    op.create_check_constraint(
        "description_required",
        "tickets",
        "(service_type IN ('Tech Visit', 'Service')) = (description IS NOT NULL)",
    )
    op.drop_constraint("service_types", "product_models", type_="check")
    op.create_check_constraint(
        "service_types",
        "product_models",
        "jsonb_typeof(service_types) = 'array' "
        "AND jsonb_array_length(service_types) >= 1 "
        "AND service_types <@ "
        "'[\"Installation + Demo\", \"Tech Visit\", \"Service\", "
        "\"Uninstall\"]'::jsonb",
    )

    # ── A2 / A6 / A7: the four new ticket columns ────────────────────────────
    # NOT NULL DEFAULT false/'offline' is a catalogue-only change on
    # Postgres >= 11: no table rewrite, no long lock.
    op.add_column(
        "tickets",
        sa.Column(
            "is_high_priority",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.add_column(
        "tickets", sa.Column("customer_alt_phone", sa.String(length=20), nullable=True)
    )
    op.add_column(
        "tickets",
        sa.Column(
            "purchase_mode",
            sa.String(length=16),
            server_default=sa.text("'offline'"),
            nullable=False,
        ),
    )
    op.add_column(
        "tickets", sa.Column("purchase_platform_id", sa.Uuid(), nullable=True)
    )

    op.create_check_constraint(
        "purchase_mode", "tickets", "purchase_mode IN ('online', 'offline')"
    )
    # A platform is only ever an ONLINE fact. Not required the other way:
    # `online` with no platform named is "we don't know which".
    op.create_check_constraint(
        "purchase_platform_requires_online",
        "tickets",
        "purchase_platform_id IS NULL OR purchase_mode = 'online'",
    )
    # The covering index for the composite FK below.
    op.create_index(
        "ix_tickets_company_purchase_platform",
        "tickets",
        ["company_id", "purchase_platform_id"],
    )
    # RESTRICT, like every other master a ticket names: a platform still
    # pointed at cannot disappear from under it. Deactivating one
    # (`purchase_platforms.is_active = false`) is how it is retired.
    op.create_foreign_key(
        "fk_tickets_company_purchase_platform",
        "tickets",
        "purchase_platforms",
        ["company_id", "purchase_platform_id"],
        ["company_id", "id"],
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    bind = op.get_bind()

    uninstalled = bind.scalar(
        sa.text("SELECT count(*) FROM tickets WHERE service_type = 'Uninstall'")
    )
    # `?` tests jsonb array-element membership — `service_types` is a jsonb
    # ARRAY of strings, so this asks "does any row's array contain it".
    on_products = bind.scalar(
        sa.text(
            "SELECT count(*) FROM product_models WHERE service_types ? 'Uninstall'"
        )
    )
    if uninstalled or on_products:
        raise RuntimeError(
            f"Refusing to downgrade: {uninstalled} ticket(s) are service_type "
            f"'Uninstall' and {on_products} product model(s) declare it. "
            "Re-narrowing either CHECK would refuse to run with that data in "
            "place. Reassign or remove them first."
        )

    named_platform = bind.scalar(
        sa.text("SELECT count(*) FROM tickets WHERE purchase_platform_id IS NOT NULL")
    )
    if named_platform:
        raise RuntimeError(
            f"Refusing to downgrade: {named_platform} ticket(s) name a "
            "purchase platform. Dropping the column would lose which one."
        )

    flagged = bind.scalar(
        sa.text(
            "SELECT count(*) FROM tickets "
            "WHERE is_high_priority OR customer_alt_phone IS NOT NULL"
        )
    )
    if flagged:
        raise RuntimeError(
            f"Refusing to downgrade: {flagged} ticket(s) carry a high-priority "
            "flag or a second phone number. Neither is reconstructible once "
            "the column is gone."
        )

    op.drop_index("ix_tickets_company_purchase_platform", table_name="tickets")
    op.drop_constraint(
        "fk_tickets_company_purchase_platform", "tickets", type_="foreignkey"
    )
    op.drop_constraint("purchase_platform_requires_online", "tickets", type_="check")
    op.drop_constraint("purchase_mode", "tickets", type_="check")
    op.drop_column("tickets", "purchase_platform_id")
    op.drop_column("tickets", "purchase_mode")
    op.drop_column("tickets", "customer_alt_phone")
    op.drop_column("tickets", "is_high_priority")

    op.drop_constraint("service_types", "product_models", type_="check")
    op.create_check_constraint(
        "service_types",
        "product_models",
        "jsonb_typeof(service_types) = 'array' "
        "AND jsonb_array_length(service_types) >= 1 "
        "AND service_types <@ "
        "'[\"Installation + Demo\", \"Tech Visit\", \"Service\"]'::jsonb",
    )
    op.drop_constraint("description_required", "tickets", type_="check")
    op.create_check_constraint(
        "description_required",
        "tickets",
        "(service_type = 'Installation + Demo') = (description IS NULL)",
    )
    op.drop_constraint("service_type", "tickets", type_="check")
    op.create_check_constraint(
        "service_type",
        "tickets",
        "service_type IN ('Installation + Demo', 'Tech Visit', 'Service')",
    )

    op.execute("DROP INDEX IF EXISTS uq_purchase_platforms_company_name_lower")
    op.drop_index("ix_purchase_platforms_company_id", table_name="purchase_platforms")
    op.drop_table("purchase_platforms")
