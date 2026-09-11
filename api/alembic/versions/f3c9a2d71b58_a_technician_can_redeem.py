"""A technician can redeem their balance

A technician could see what they earned and had no way to be paid it. They can
now ask for their balance, and the company pays it by UPI — a QR the server
builds and each client draws, scanned on the payer's own phone. There is no
gateway, so nothing here can see the money move; what is recorded is the
PAYER's claim ("I paid", with a screenshot) and the TECHNICIAN's confirmation
("it arrived"), which is the only thing that settles one. Four things, all in
this one revision per hard rule 8:

  * `redemptions` — one request, its amount and UPI ID frozen when asked, with
    the claim, the confirmation and any decline as nullable timestamps. "Paid"
    is `confirmed_at IS NOT NULL`, never a status value.
  * `redemption_events` — what each side SAID, append-only. The row above is
    current state and a second claim overwrites the first; with no gateway,
    this log is the only record of who said what.
  * `notifications.kind = 'redemption'`, and a new `notifications.audience`.
    A redemption is work for whoever pays — the company's National Heads, or
    its Admins where it has none — and a company-wide row would ring every
    territory manager for money none of them may pay. `audience` NARROWS a
    row to that role, resolved at read time; NULL is every existing row, so
    nothing already in the table changes who hears it.
  * `redemptions.pay` — granted by default to admin and national_head, and
    paired with a National Head rank floor in the router.

## One open redemption per technician, enforced here

`uq_redemptions_one_open` is a partial UNIQUE on `(company_id, technician_id)`
while neither confirmed nor declined, so two taps on a slow connection cannot
ask for the same balance twice.

## The downgrade refuses while any redemption exists

Dropping the table would delete the only record that a technician was paid —
and with it, the reservation that stops their balance being paid a second time.
That is not a trade a migration should make on its own, so it stops and says
how many there are, the shape `e8b2f47c19d3` uses for reversals.

Revision ID: f3c9a2d71b58
Revises: e8b2f47c19d3
Create Date: 2026-09-11 16:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f3c9a2d71b58"
down_revision: Union[str, Sequence[str], None] = "e8b2f47c19d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


#: The notification kinds as they stand before this revision. Spelled out rather
#: than imported from the model: a migration must keep describing the database
#: it was written against, even after the model has moved on.
_NOTIFICATIONS = (
    "'escalation', 'ai', 'serial_mismatch', 'force_close', 'slot', "
    "'technician_joined', 'job_started', 'invite_expired', 'assigned', "
    "'no_show', 'product_submitted', 'product_approved', 'product_rejected', "
    "'rescheduled'"
)

_FEATURE = "redemptions.pay"
_ROLES = ("admin", "national_head")


def upgrade() -> None:
    # ── redemptions ───────────────────────────────────────────────────────────
    op.create_table(
        "redemptions",
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("technician_id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("amount_paise", sa.Integer(), nullable=False),
        sa.Column("upi_id", sa.String(length=256), nullable=False),
        sa.Column("payee_name", sa.String(length=120), nullable=False),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("claimed_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("claimed_by_label", sa.String(length=120), nullable=True),
        sa.Column("utr", sa.String(length=35), nullable=True),
        sa.Column("proof_blob_name", sa.String(length=255), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("declined_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("declined_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("declined_by_label", sa.String(length=120), nullable=True),
        sa.Column("decline_reason", sa.String(length=160), nullable=True),
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
        sa.CheckConstraint("amount_paise > 0", name="amount_paise"),
        sa.CheckConstraint(
            "position('@' in upi_id) > 1 AND upi_id !~ '\\s' "
            "AND length(upi_id) >= 3",
            name="upi_id",
        ),
        sa.CheckConstraint(
            "(claimed_at IS NULL) = (proof_blob_name IS NULL)", name="claim_has_proof"
        ),
        sa.CheckConstraint(
            "confirmed_at IS NULL OR claimed_at IS NOT NULL",
            name="confirmed_after_claim",
        ),
        sa.CheckConstraint(
            "declined_at IS NULL OR claimed_at IS NULL", name="declined_before_claim"
        ),
        sa.CheckConstraint(
            "(declined_at IS NULL) = (decline_reason IS NULL)",
            name="decline_has_reason",
        ),
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "technician_id"],
            ["technician_profiles.company_id", "technician_profiles.id"],
            name="fk_redemptions_company_technician",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "id", name="uq_redemptions_company_id_id"),
        sa.UniqueConstraint("company_id", "code", name="uq_redemptions_company_code"),
    )
    op.create_index(
        "uq_redemptions_one_open",
        "redemptions",
        ["company_id", "technician_id"],
        unique=True,
        postgresql_where=sa.text("confirmed_at IS NULL AND declined_at IS NULL"),
    )
    op.create_index(
        "ix_redemptions_company_technician",
        "redemptions",
        ["company_id", "technician_id", "created_at"],
    )
    op.create_index(
        "ix_redemptions_company_created", "redemptions", ["company_id", "created_at"]
    )

    # ── redemption_events ─────────────────────────────────────────────────────
    op.create_table(
        "redemption_events",
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("redemption_id", sa.Uuid(), nullable=False),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("actor_kind", sa.String(length=16), nullable=False),
        sa.Column("actor_label", sa.String(length=120), nullable=True),
        sa.Column("utr", sa.String(length=35), nullable=True),
        sa.Column("proof_blob_name", sa.String(length=255), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
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
            "kind IN ('requested', 'claimed', 'denied', 'confirmed', 'declined')",
            name="kind",
        ),
        sa.CheckConstraint("actor_kind IN ('staff', 'technician')", name="actor_kind"),
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "redemption_id"],
            ["redemptions.company_id", "redemptions.id"],
            name="fk_redemption_events_company_redemption",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_redemption_events_company_redemption",
        "redemption_events",
        ["company_id", "redemption_id", "seq"],
    )

    # ── notifications ─────────────────────────────────────────────────────────
    op.drop_constraint("kind", "notifications", type_="check")
    op.create_check_constraint(
        "kind", "notifications", f"kind IN ({_NOTIFICATIONS}, 'redemption')"
    )
    # Nullable, and null is every row written before this — their audience is
    # the territory rule, unchanged.
    op.add_column(
        "notifications", sa.Column("audience", sa.String(length=16), nullable=True)
    )
    op.create_check_constraint(
        "audience", "notifications", "audience IS NULL OR audience IN ('payers')"
    )

    # ── the feature ───────────────────────────────────────────────────────────
    # WHERE NOT EXISTS on both inserts: a database stood up from a later seed
    # could already carry these rows, and re-running must be inert.
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
            "label": "Pay Redemptions",
            # Under the company's money, beside the ledger it is paid out of.
            "parent": "earnings.view",
            "sort": 71,
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

    # Refuse rather than delete money. See the module docstring.
    redemptions = bind.execute(sa.text("SELECT count(*) FROM redemptions")).scalar()
    if redemptions:
        raise RuntimeError(
            f"{redemptions} redemption(s) exist. Downgrading would delete the "
            "record that those technicians were paid, and let the same balance "
            "be paid again. Decide what should happen to them first."
        )

    for table in ("company_role_features", "role_feature_defaults"):
        bind.execute(
            sa.text(
                f"DELETE FROM {table} "
                "WHERE feature_id IN (SELECT id FROM features WHERE key = :key)"
            ),
            {"key": _FEATURE},
        )
    bind.execute(sa.text("DELETE FROM features WHERE key = :key"), {"key": _FEATURE})

    # The bells go before the CHECK that would refuse them — same trade-off as
    # `d6a1f38b04e5`: a notification is a work item somebody has already seen.
    op.execute(
        "DELETE FROM notification_reads WHERE notification_id IN "
        "(SELECT id FROM notifications WHERE kind = 'redemption' "
        "OR audience IS NOT NULL)"
    )
    op.execute(
        "DELETE FROM notifications WHERE kind = 'redemption' OR audience IS NOT NULL"
    )
    op.drop_constraint("audience", "notifications", type_="check")
    op.drop_column("notifications", "audience")
    op.drop_constraint("kind", "notifications", type_="check")
    op.create_check_constraint("kind", "notifications", f"kind IN ({_NOTIFICATIONS})")

    op.drop_index(
        "ix_redemption_events_company_redemption", table_name="redemption_events"
    )
    op.drop_table("redemption_events")
    op.drop_index("ix_redemptions_company_created", table_name="redemptions")
    op.drop_index("ix_redemptions_company_technician", table_name="redemptions")
    op.drop_index("uq_redemptions_one_open", table_name="redemptions")
    op.drop_table("redemptions")
