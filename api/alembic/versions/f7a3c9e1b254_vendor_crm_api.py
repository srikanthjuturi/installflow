"""The vendor CRM ticket API: credentials, tokens, call logs and a vendor SKU

Four additions, all for the third intake channel (`API`):

* `api_credentials` — a Client ID and a hashed Client Secret that belong to ONE
  vendor. Revoked, never deleted.
* `api_refresh_tokens` — the 30-day renewal tokens issued from a credential,
  stored only as a hash.
* `integration_call_logs` — one row per call from a CRM that names a known
  credential. `created_at` IS the time of the call. `detail` (a redacted request
  summary) is cleared after 30 days and the row deleted after a year by a
  scheduled job; nothing here ever holds a secret or a token.
* `product_models.sku` — the vendor's own code for a product, so a CRM can name
  a product without knowing our ids. Unique per vendor ignoring case, as a
  hand-written partial index on live rows.

And one feature key, `integrations.manage`, granted to Admin and National Head.

No backfill: every existing product simply has no SKU.

Hand-written, like its siblings: autogenerate would try to drop the
hand-written partial and functional indexes (`uq_tickets_vendor_external_ref`,
`uq_companies_gst_lower` and the rest), which Alembic does not recognise.

Revision ID: f7a3c9e1b254
Revises: e5b81c3d9a27
Create Date: 2026-11-05

NOTE: stacked on `e5b81c3d9a27`, the head the development database is on, and
NOT on `d4f8a21b9c56` (held back until the duplicate serials are resolved, see
`b7c3f0a5d9e1`). The two heads are still unmerged; migrate to this revision by
id, never `head`.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f7a3c9e1b254"
down_revision: Union[str, Sequence[str], None] = "e5b81c3d9a27"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (key, label, parent_key, sort_order)
FEATURES = [("integrations.manage", "Manage API integrations", None, 130)]

DEFAULTS = {
    "admin": ["integrations.manage"],
    "national_head": ["integrations.manage"],
}


def _audit() -> list[sa.Column]:
    """The six columns `AuditMixin` gives every business table."""
    return [
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
    ]


def upgrade() -> None:
    # ── api_credentials ───────────────────────────────────────────────────
    op.create_table(
        "api_credentials",
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("vendor_id", sa.Uuid(), nullable=False),
        sa.Column("client_id", sa.String(length=64), nullable=False),
        sa.Column("secret_hash", sa.String(length=64), nullable=False),
        sa.Column("note", sa.String(length=120), nullable=True),
        sa.Column("replaces_id", sa.Uuid(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_by", sa.Uuid(), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        *_audit(),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_api_credentials")),
        sa.ForeignKeyConstraint(
            ["company_id"],
            ["companies.id"],
            name=op.f("fk_api_credentials_company_id_companies"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "vendor_id"],
            ["vendors.company_id", "vendors.id"],
            name="fk_api_credentials_company_vendor",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("company_id", "id", name="uq_api_credentials_company_id_id"),
        sa.UniqueConstraint("client_id", name="uq_api_credentials_client_id"),
    )
    # The covering index for the composite FK above, columns IN ORDER, and the
    # console's per-vendor list.
    op.create_index(
        "ix_api_credentials_company_vendor",
        "api_credentials",
        ["company_id", "vendor_id"],
    )

    # ── api_refresh_tokens ────────────────────────────────────────────────
    op.create_table(
        "api_refresh_tokens",
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("credential_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        *_audit(),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_api_refresh_tokens")),
        sa.ForeignKeyConstraint(
            ["company_id"],
            ["companies.id"],
            name=op.f("fk_api_refresh_tokens_company_id_companies"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "credential_id"],
            ["api_credentials.company_id", "api_credentials.id"],
            name="fk_api_refresh_tokens_company_credential",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("token_hash", name="uq_api_refresh_tokens_token_hash"),
    )
    op.create_index(
        "ix_api_refresh_tokens_company_credential",
        "api_refresh_tokens",
        ["company_id", "credential_id"],
    )

    # ── integration_call_logs ─────────────────────────────────────────────
    op.create_table(
        "integration_call_logs",
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("vendor_id", sa.Uuid(), nullable=False),
        sa.Column("credential_id", sa.Uuid(), nullable=False),
        sa.Column("endpoint", sa.String(length=24), nullable=False),
        sa.Column("http_status", sa.SmallInteger(), nullable=False),
        sa.Column("outcome_code", sa.String(length=48), nullable=True),
        sa.Column(
            "check_only", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column("crm_reference", sa.String(length=64), nullable=True),
        sa.Column("ticket_id", sa.Uuid(), nullable=True),
        sa.Column("repeat", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("detail", sa.dialects.postgresql.JSONB(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        *_audit(),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_integration_call_logs")),
        sa.ForeignKeyConstraint(
            ["company_id"],
            ["companies.id"],
            name=op.f("fk_integration_call_logs_company_id_companies"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "credential_id"],
            ["api_credentials.company_id", "api_credentials.id"],
            name="fk_integration_call_logs_company_credential",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "endpoint IN ('token', 'create_ticket', 'get_ticket', 'list_tickets')",
            name=op.f("ck_integration_call_logs_endpoint"),
        ),
    )
    # The screen and the retention job read by company and time; the per-minute
    # limit reads by credential and time. The first is also the covering index
    # for the company FK.
    op.create_index(
        "ix_integration_call_logs_company_created",
        "integration_call_logs",
        ["company_id", sa.text("created_at DESC")],
    )
    op.create_index(
        "ix_integration_call_logs_credential_created",
        "integration_call_logs",
        ["credential_id", "created_at"],
    )

    # ── product_models.sku ────────────────────────────────────────────────
    op.add_column(
        "product_models", sa.Column("sku", sa.String(length=64), nullable=True)
    )
    op.create_check_constraint(
        "sku", "product_models", "sku IS NULL OR length(btrim(sku)) > 0"
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_product_models_vendor_sku_lower ON product_models "
        "(company_id, vendor_id, lower(sku)) "
        "WHERE deleted_at IS NULL AND sku IS NOT NULL"
    )

    # ── the feature key ───────────────────────────────────────────────────
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "INSERT INTO features (key, label, parent_key, sort_order, is_active) "
            "VALUES (:k, :l, :p, :s, true)"
        ),
        [{"k": k, "l": lbl, "p": p, "s": s} for k, lbl, p, s in FEATURES],
    )
    conn.execute(
        sa.text(
            "INSERT INTO role_feature_defaults (role, feature_id, enabled) "
            "SELECT :role, f.id, true FROM features f WHERE f.key = :key"
        ),
        [
            {"role": role, "key": key}
            for role, keys in DEFAULTS.items()
            for key in keys
        ],
    )


def downgrade() -> None:
    conn = op.get_bind()
    keys = [k for k, _, _, _ in FEATURES]
    conn.execute(
        sa.text(
            "DELETE FROM role_feature_defaults WHERE feature_id IN "
            "(SELECT id FROM features WHERE key = ANY(:keys))"
        ),
        {"keys": keys},
    )
    conn.execute(
        sa.text(
            "DELETE FROM company_role_features WHERE feature_id IN "
            "(SELECT id FROM features WHERE key = ANY(:keys))"
        ),
        {"keys": keys},
    )
    conn.execute(sa.text("DELETE FROM features WHERE key = ANY(:keys)"), {"keys": keys})

    op.execute("DROP INDEX IF EXISTS uq_product_models_vendor_sku_lower")
    op.drop_constraint("sku", "product_models", type_="check")
    op.drop_column("product_models", "sku")

    op.drop_index("ix_integration_call_logs_credential_created", "integration_call_logs")
    op.drop_index("ix_integration_call_logs_company_created", "integration_call_logs")
    op.drop_table("integration_call_logs")
    op.drop_index("ix_api_refresh_tokens_company_credential", "api_refresh_tokens")
    op.drop_table("api_refresh_tokens")
    op.drop_index("ix_api_credentials_company_vendor", "api_credentials")
    op.drop_table("api_credentials")
