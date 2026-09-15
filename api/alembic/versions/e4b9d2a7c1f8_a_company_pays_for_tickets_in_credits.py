"""A company pays for tickets in credits, and recharges by UPI to the platform

Companies are moving to subscription access. All in this one revision per hard
rule 8:

  * `platform_settings` — ONE row, belonging to no company: free credits for a
    new company, what a ticket costs, how far below zero a company may go, the
    smallest recharge, and the platform's own UPI ID that recharges are paid
    to. Seeded with 1000 / 10 / 500 / 100 and no UPI ID.
  * `credit_entries` — append-only; a company's balance is their sum. `free`
    (the one-time gift), `ticket` (charged when a ticket is raised), `recharge`
    (credited when the superadmin confirms a payment).
  * `credit_recharges` — the company claims it paid, with a UTR and a
    screenshot; the superadmin confirms or rejects. One open per company.
  * `notifications.kind` gains `credits` and `recharge`; `notifications.audience`
    gains `billing` — Admins and National Heads together.
  * Feature `credits.manage`, for Admin and National Head.

## Every existing company gets its free credits today

A `free` entry of 1000 for each, so nobody's intake stops on the day this ships.

## The downgrade refuses to destroy billing history

Once a ticket has been charged or a recharge asked for, dropping these tables
would erase what a company paid and spent. It stops and says so.

Revision ID: e4b9d2a7c1f8
Revises: c5e8a1d3f7b2
Create Date: 2026-09-14 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e4b9d2a7c1f8"
down_revision: Union[str, Sequence[str], None] = "c5e8a1d3f7b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


#: As the database stands before this revision — spelled out, not imported.
_NOTIFICATIONS = (
    "'escalation', 'ai', 'serial_mismatch', 'force_close', 'slot', "
    "'technician_joined', 'job_started', 'invite_expired', 'assigned', "
    "'no_show', 'product_submitted', 'product_approved', 'product_rejected', "
    "'rescheduled', 'redemption', 'brand_submitted', 'brand_approved', "
    "'brand_rejected', 'upi_change'"
)
_AUDIENCES = "'payers', 'area_manager', 'regional_head', 'national_head', 'admin'"

_FEATURE = "credits.manage"
_ROLES = ("admin", "national_head")

#: The launch-day gift, spelled out: the migration writes what the platform
#: shipped with, not whatever `PLATFORM_DEFAULTS` says by the time it runs.
_FREE_CREDITS = 1000

_VPA_CHECK = "position('@' in {col}) > 1 AND {col} !~ '\\s' AND length({col}) >= 3"


def _audit_columns() -> list[sa.Column]:
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
    # ── platform_settings ─────────────────────────────────────────────────────
    op.create_table(
        "platform_settings",
        sa.Column("id", sa.SmallInteger(), nullable=False),
        sa.Column("free_credits", sa.Integer(), nullable=False),
        sa.Column("ticket_credits", sa.Integer(), nullable=False),
        sa.Column("minus_credit_limit", sa.Integer(), nullable=False),
        sa.Column("min_recharge_credits", sa.Integer(), nullable=False),
        sa.Column("upi_id", sa.String(length=256), nullable=True),
        sa.Column("upi_name", sa.String(length=120), nullable=True),
        *_audit_columns(),
        sa.CheckConstraint("id = 1", name="single_row"),
        sa.CheckConstraint("free_credits BETWEEN 0 AND 1000000", name="free_credits"),
        sa.CheckConstraint("ticket_credits BETWEEN 0 AND 10000", name="ticket_credits"),
        sa.CheckConstraint(
            "minus_credit_limit BETWEEN 0 AND 1000000", name="minus_credit_limit"
        ),
        sa.CheckConstraint(
            "min_recharge_credits BETWEEN 1 AND 100000", name="min_recharge_credits"
        ),
        sa.CheckConstraint(
            "upi_id IS NULL OR (" + _VPA_CHECK.format(col="upi_id") + ")",
            name="upi_id",
        ),
        sa.CheckConstraint("(upi_id IS NULL) = (upi_name IS NULL)", name="upi_pair"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute(
        "INSERT INTO platform_settings "
        "(id, free_credits, ticket_credits, minus_credit_limit, min_recharge_credits) "
        "VALUES (1, 1000, 10, 500, 100)"
    )

    # ── credit_recharges ──────────────────────────────────────────────────────
    op.create_table(
        "credit_recharges",
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("amount_paise", sa.Integer(), nullable=False),
        sa.Column("upi_id", sa.String(length=256), nullable=False),
        sa.Column("payee_name", sa.String(length=120), nullable=False),
        sa.Column("requested_by_label", sa.String(length=120), nullable=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("claimed_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("claimed_by_label", sa.String(length=120), nullable=True),
        sa.Column("utr", sa.String(length=35), nullable=True),
        sa.Column("proof_blob_name", sa.String(length=255), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("confirmed_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("confirmed_by_label", sa.String(length=120), nullable=True),
        sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejected_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("rejected_by_label", sa.String(length=120), nullable=True),
        sa.Column("reject_reason", sa.String(length=160), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_by_label", sa.String(length=120), nullable=True),
        *_audit_columns(),
        sa.CheckConstraint(
            "amount_paise > 0 AND amount_paise % 100 = 0 AND amount_paise <= 10000000",
            name="amount_paise",
        ),
        sa.CheckConstraint(_VPA_CHECK.format(col="upi_id"), name="upi_id"),
        sa.CheckConstraint(
            "(claimed_at IS NULL) = (utr IS NULL) "
            "AND (claimed_at IS NULL) = (proof_blob_name IS NULL)",
            name="claim_complete",
        ),
        sa.CheckConstraint(
            "(confirmed_at IS NULL AND rejected_at IS NULL) OR claimed_at IS NOT NULL",
            name="decided_after_claim",
        ),
        sa.CheckConstraint(
            "cancelled_at IS NULL OR claimed_at IS NULL", name="cancelled_before_claim"
        ),
        sa.CheckConstraint(
            "num_nonnulls(confirmed_at, rejected_at, cancelled_at) <= 1",
            name="one_outcome",
        ),
        sa.CheckConstraint(
            "(rejected_at IS NULL) = (reject_reason IS NULL)", name="reject_has_reason"
        ),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "id", name="uq_credit_recharges_company_id_id"),
        sa.UniqueConstraint(
            "company_id", "code", name="uq_credit_recharges_company_code"
        ),
    )
    op.create_index(
        "uq_credit_recharges_one_open",
        "credit_recharges",
        ["company_id"],
        unique=True,
        postgresql_where=sa.text(
            "confirmed_at IS NULL AND rejected_at IS NULL AND cancelled_at IS NULL"
        ),
    )
    op.create_index(
        "ix_credit_recharges_company_created",
        "credit_recharges",
        ["company_id", "created_at"],
    )
    op.create_index(
        "ix_credit_recharges_waiting",
        "credit_recharges",
        ["claimed_at"],
        postgresql_where=sa.text(
            "claimed_at IS NOT NULL AND confirmed_at IS NULL AND rejected_at IS NULL"
        ),
    )
    # One payment buys credits once — see the model.
    op.create_index(
        "uq_credit_recharges_credited_utr",
        "credit_recharges",
        ["utr"],
        unique=True,
        postgresql_where=sa.text("confirmed_at IS NOT NULL"),
    )

    # ── credit_entries ────────────────────────────────────────────────────────
    op.create_table(
        "credit_entries",
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("credits", sa.Integer(), nullable=False),
        sa.Column("ticket_id", sa.Uuid(), nullable=True),
        sa.Column("recharge_id", sa.Uuid(), nullable=True),
        *_audit_columns(),
        sa.CheckConstraint("kind IN ('free', 'ticket', 'recharge')", name="kind"),
        sa.CheckConstraint("credits > 0", name="credits"),
        sa.CheckConstraint(
            "(kind = 'ticket') = (ticket_id IS NOT NULL)", name="ticket_link"
        ),
        sa.CheckConstraint(
            "(kind = 'recharge') = (recharge_id IS NOT NULL)", name="recharge_link"
        ),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["company_id", "ticket_id"],
            ["tickets.company_id", "tickets.id"],
            name="fk_credit_entries_company_ticket",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "recharge_id"],
            ["credit_recharges.company_id", "credit_recharges.id"],
            name="fk_credit_entries_company_recharge",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_credit_entries_company_ticket",
        "credit_entries",
        ["company_id", "ticket_id"],
        unique=True,
        postgresql_where=sa.text("ticket_id IS NOT NULL"),
    )
    op.create_index(
        "uq_credit_entries_company_recharge",
        "credit_entries",
        ["company_id", "recharge_id"],
        unique=True,
        postgresql_where=sa.text("recharge_id IS NOT NULL"),
    )
    op.create_index(
        "uq_credit_entries_company_free",
        "credit_entries",
        ["company_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'free'"),
    )
    op.create_index(
        "ix_credit_entries_company_created",
        "credit_entries",
        ["company_id", "created_at"],
    )

    # Launch day: every company that already exists gets its gift.
    op.execute(
        "INSERT INTO credit_entries (company_id, kind, credits) "
        f"SELECT id, 'free', {_FREE_CREDITS} FROM companies"
    )

    # ── notifications ─────────────────────────────────────────────────────────
    op.drop_constraint("kind", "notifications", type_="check")
    op.create_check_constraint(
        "kind", "notifications", f"kind IN ({_NOTIFICATIONS}, 'credits', 'recharge')"
    )
    op.drop_constraint("audience", "notifications", type_="check")
    op.create_check_constraint(
        "audience",
        "notifications",
        f"audience IS NULL OR audience IN ({_AUDIENCES}, 'billing')",
    )

    # ── the feature ───────────────────────────────────────────────────────────
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            INSERT INTO features (key, label, parent_key, sort_order)
            SELECT CAST(:key AS varchar), CAST(:label AS varchar),
                   CAST(:parent AS varchar), CAST(:sort AS integer)
            WHERE NOT EXISTS (SELECT 1 FROM features WHERE key = :key)
            """
        ),
        {
            "key": _FEATURE,
            "label": "Credits & Recharge",
            # Beside the company's other settings.
            "parent": "settings.view",
            "sort": 93,
        },
    )
    for role in _ROLES:
        bind.execute(
            sa.text(
                """
                INSERT INTO role_feature_defaults (role, feature_id, enabled)
                SELECT CAST(:role AS varchar), f.id, true
                FROM features f
                WHERE f.key = :key
                  AND NOT EXISTS (
                        SELECT 1 FROM role_feature_defaults rfd
                        WHERE rfd.role = CAST(:role AS varchar)
                          AND rfd.feature_id = f.id
                  )
                """
            ),
            {"role": role, "key": _FEATURE},
        )


def downgrade() -> None:
    bind = op.get_bind()
    spent = bind.execute(
        sa.text(
            "SELECT (SELECT count(*) FROM credit_entries WHERE kind = 'ticket') "
            "+ (SELECT count(*) FROM credit_recharges)"
        )
    ).scalar()
    if spent:
        raise RuntimeError(
            f"{spent} ticket charge(s) or recharge(s) exist. Downgrading would erase "
            "what companies paid and spent."
        )

    bind.execute(
        sa.text(
            "DELETE FROM company_role_features WHERE feature_id IN "
            "(SELECT id FROM features WHERE key = :key)"
        ),
        {"key": _FEATURE},
    )
    bind.execute(
        sa.text(
            "DELETE FROM role_feature_defaults WHERE feature_id IN "
            "(SELECT id FROM features WHERE key = :key)"
        ),
        {"key": _FEATURE},
    )
    bind.execute(sa.text("DELETE FROM features WHERE key = :key"), {"key": _FEATURE})

    op.execute(
        "DELETE FROM notification_reads WHERE notification_id IN "
        "(SELECT id FROM notifications WHERE kind IN ('credits', 'recharge') "
        "OR audience = 'billing')"
    )
    op.execute(
        "DELETE FROM notifications WHERE kind IN ('credits', 'recharge') "
        "OR audience = 'billing'"
    )
    op.drop_constraint("audience", "notifications", type_="check")
    op.create_check_constraint(
        "audience", "notifications", f"audience IS NULL OR audience IN ({_AUDIENCES})"
    )
    op.drop_constraint("kind", "notifications", type_="check")
    op.create_check_constraint("kind", "notifications", f"kind IN ({_NOTIFICATIONS})")

    op.drop_index("ix_credit_entries_company_created", table_name="credit_entries")
    op.drop_index("uq_credit_entries_company_free", table_name="credit_entries")
    op.drop_index("uq_credit_entries_company_recharge", table_name="credit_entries")
    op.drop_index("uq_credit_entries_company_ticket", table_name="credit_entries")
    op.drop_table("credit_entries")
    op.drop_index("uq_credit_recharges_credited_utr", table_name="credit_recharges")
    op.drop_index("ix_credit_recharges_waiting", table_name="credit_recharges")
    op.drop_index("ix_credit_recharges_company_created", table_name="credit_recharges")
    op.drop_index("uq_credit_recharges_one_open", table_name="credit_recharges")
    op.drop_table("credit_recharges")
    op.drop_table("platform_settings")
