"""A UPI ID is proved once, then changed only by request

A technician's UPI ID was a free text box: set, changed or cleared at will from
the app, with nothing to say the person holding the phone was the person being
paid. It is where their money lands, so it now works like this, all in this one
revision per hard rule 8:

  * `technician_profiles.upi_name` — the name on the account, scanned off the
    UPI QR's `pn` or typed. What a payer's app shows when they scan, so what a
    redemption tells them to check. Nullable: accounts added before this have
    none, and a redemption then falls back to the technician's own name.
  * `otp_codes.purpose = 'payout_account'` — adding a UPI ID takes a code sent
    to the technician's OWN registered WhatsApp number.
  * `upi_change_requests` — once one is on file, changing it is a request the
    technician makes and a manager decides, with no code. One pending per
    technician (`uq_upi_change_requests_one_pending`).
  * `notifications.kind = 'upi_change'`, and `notifications.audience` widened
    from `'payers'` to the four staff role keys. The request rings the Area
    Manager for the technician's area, else the Regional Head, else a National
    Head, else an Admin — a ROLE-addressed row, still narrowed to its
    territory by its pincode for the two territory roles.

Nothing is backfilled. Existing UPI IDs stay exactly as they are and simply
become "on file": changing any of them is now a request.

Revision ID: b7d2c9e41f60
Revises: a4d8e61f2c07
Create Date: 2026-09-11 18:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b7d2c9e41f60"
down_revision: Union[str, Sequence[str], None] = "a4d8e61f2c07"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


#: As the database stands before this revision — spelled out, not imported.
_NOTIFICATIONS = (
    "'escalation', 'ai', 'serial_mismatch', 'force_close', 'slot', "
    "'technician_joined', 'job_started', 'invite_expired', 'assigned', "
    "'no_show', 'product_submitted', 'product_approved', 'product_rejected', "
    "'rescheduled', 'redemption', 'brand_submitted', 'brand_approved', "
    "'brand_rejected'"
)
_AUDIENCE_OLD = "audience IS NULL OR audience IN ('payers')"
_AUDIENCE_NEW = (
    "audience IS NULL OR audience IN ('payers', 'area_manager', "
    "'regional_head', 'national_head', 'admin')"
)
_PURPOSE_OLD = "purpose IN ('login','invite','password_reset','reschedule')"
_PURPOSE_NEW = (
    "purpose IN ('login','invite','password_reset','reschedule','payout_account')"
)


def upgrade() -> None:
    # ── technician_profiles ───────────────────────────────────────────────────
    op.add_column(
        "technician_profiles",
        sa.Column("upi_name", sa.String(length=120), nullable=True),
    )

    # ── upi_change_requests ───────────────────────────────────────────────────
    op.create_table(
        "upi_change_requests",
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("technician_id", sa.Uuid(), nullable=False),
        sa.Column("old_upi_id", sa.String(length=256), nullable=False),
        sa.Column("old_upi_name", sa.String(length=120), nullable=True),
        sa.Column("new_upi_id", sa.String(length=256), nullable=False),
        sa.Column("new_upi_name", sa.String(length=120), nullable=False),
        sa.Column(
            "status",
            sa.String(length=16),
            server_default=sa.text("'pending'"),
            nullable=False,
        ),
        sa.Column("reviewer_role", sa.String(length=24), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("decided_by_label", sa.String(length=120), nullable=True),
        sa.Column("reject_reason", sa.String(length=160), nullable=True),
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
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected', 'cancelled')",
            name="status",
        ),
        sa.CheckConstraint(
            "reviewer_role IN ('area_manager', 'regional_head', 'national_head', "
            "'admin')",
            name="reviewer_role",
        ),
        sa.CheckConstraint(
            "position('@' in new_upi_id) > 1 AND new_upi_id !~ '\\s' "
            "AND length(new_upi_id) >= 3",
            name="new_upi_id",
        ),
        sa.CheckConstraint(
            "(status = 'pending') = (decided_at IS NULL)", name="decided_when_closed"
        ),
        sa.CheckConstraint(
            "(status = 'rejected') = (reject_reason IS NOT NULL)",
            name="rejection_has_reason",
        ),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["company_id", "technician_id"],
            ["technician_profiles.company_id", "technician_profiles.id"],
            name="fk_upi_change_requests_company_technician",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_upi_change_requests_one_pending",
        "upi_change_requests",
        ["company_id", "technician_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_index(
        "ix_upi_change_requests_company_technician",
        "upi_change_requests",
        ["company_id", "technician_id", "created_at"],
    )

    # ── otp_codes ─────────────────────────────────────────────────────────────
    op.drop_constraint("purpose", "otp_codes", type_="check")
    op.create_check_constraint("purpose", "otp_codes", _PURPOSE_NEW)

    # ── notifications ─────────────────────────────────────────────────────────
    op.drop_constraint("kind", "notifications", type_="check")
    op.create_check_constraint(
        "kind", "notifications", f"kind IN ({_NOTIFICATIONS}, 'upi_change')"
    )
    op.drop_constraint("audience", "notifications", type_="check")
    op.create_check_constraint("audience", "notifications", _AUDIENCE_NEW)


def downgrade() -> None:
    # The bells first, before the CHECKs that would refuse them — a work item
    # somebody has already seen, not a record anything else depends on.
    op.execute(
        "DELETE FROM notification_reads WHERE notification_id IN "
        "(SELECT id FROM notifications WHERE kind = 'upi_change' "
        "OR audience IN ('area_manager', 'regional_head', 'national_head', 'admin'))"
    )
    op.execute(
        "DELETE FROM notifications WHERE kind = 'upi_change' "
        "OR audience IN ('area_manager', 'regional_head', 'national_head', 'admin')"
    )
    op.drop_constraint("audience", "notifications", type_="check")
    op.create_check_constraint("audience", "notifications", _AUDIENCE_OLD)
    op.drop_constraint("kind", "notifications", type_="check")
    op.create_check_constraint("kind", "notifications", f"kind IN ({_NOTIFICATIONS})")

    # Spent or expiring one-time codes — never anything a person needs again.
    op.execute("DELETE FROM otp_codes WHERE purpose = 'payout_account'")
    op.drop_constraint("purpose", "otp_codes", type_="check")
    op.create_check_constraint("purpose", "otp_codes", _PURPOSE_OLD)

    op.drop_index(
        "ix_upi_change_requests_company_technician", table_name="upi_change_requests"
    )
    op.drop_index("uq_upi_change_requests_one_pending", table_name="upi_change_requests")
    op.drop_table("upi_change_requests")
    # The UPI IDs themselves stay; only the name beside them goes.
    op.drop_column("technician_profiles", "upi_name")
