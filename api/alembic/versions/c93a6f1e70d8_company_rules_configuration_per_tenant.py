"""company rules: the configuration screen becomes per-tenant storage

Revision ID: c93a6f1e70d8
Revises: b52e7c04a91f
Create Date: 2026-08-31 17:20:11.402887

The Rules configuration screen has never stored anything. Its seven values were
written to a JavaScript object that died with the browser tab, while the three
the server actually enforces — slot silence, the escalation window, the
force-close wait — lived in `Settings`, read from `.env` at process start.

That made them DEPLOYMENT config for a MULTI-TENANT product. One escalation
window for every company on the server, changed by editing a file and
restarting, with no screen able to affect it. The two agreed only by
authorship, and nothing would have told anybody when they stopped.

This migration gives the rules a home:

  * `company_rules`, one row per company, `ON DELETE CASCADE`.
  * Every existing company backfilled with EXACTLY the constants that were live
    the moment before — so nothing changes behaviour on deploy; only the place
    the numbers are kept moves.
  * `settings.edit`, so viewing the screen and changing what it governs stop
    being the same grant. `settings.view` alone has been enough to press Save
    since the screen existed, which was harmless only because Save did nothing.

Two rules arrive here having never been configurable anywhere: the
re-notification grace and the technician's slot reminder. Both were already
`Settings` constants; they are in the table because they are the same KIND of
number as its neighbours, and leaving them behind would have left a second,
smaller config flow to remember.

`SWEEP_INTERVAL_SECONDS` deliberately stays in `Settings`. How often a worker
wakes is infrastructure, not policy — and it is the resolution limit every
timing rule here is subject to, since nothing fires more precisely than a tick.

## Why the money columns are JSONB

`cancel_penalties_paise` and `bonus_bands_paise` are bounded lists, always read
whole with their row and never queried on their own — the same case
`product_models.image_urls` and `service_types` already make. It also survives
the open ruling on the penalty bands: the console shows four cutting at 4h/2h
and the technician app three cutting at 8h/4h, and whichever wins changes the
list's LENGTH. Four columns would make that a migration; an array makes it a
value. The CHECKs enforce the arity; the per-element bounds live in the request
schema, because bounding each element needs `jsonb_array_elements` and Postgres
refuses a subquery inside a CHECK. Same split `product_models.image_urls`
already makes, arrived at the same way.

## No `ix_company_rules_company_id`

`uq_company_rules_company` is on `(company_id)` and serves the same prefix. Hard
rule 6's other half: do not add an index a unique already covers.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "c93a6f1e70d8"
down_revision: Union[str, Sequence[str], None] = "b52e7c04a91f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


#: Granted to the two roles that already hold `settings.view` by default. A
#: company can still hand it further down through Feature Access; what it can no
#: longer do is hand it down by accident, which is what one combined key did.
EDIT_ROLES = ("admin", "national_head")


def upgrade() -> None:
    op.create_table(
        "company_rules",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column(
            "cancel_penalties_paise",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[30000, 50000, 80000, 120000]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "cancel_penalty_cap_paise",
            sa.Integer(),
            server_default=sa.text("500000"),
            nullable=False,
        ),
        sa.Column(
            "bonus_bands_paise",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[20000, 40000, 60000, 80000]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "ai_confidence_threshold",
            sa.Integer(),
            server_default=sa.text("70"),
            nullable=False,
        ),
        sa.Column(
            "sla_warn_at_pct", sa.Integer(), server_default=sa.text("25"), nullable=False
        ),
        sa.Column(
            "slot_silence_hours",
            sa.Integer(),
            server_default=sa.text("6"),
            nullable=False,
        ),
        sa.Column(
            "escalate_hours_before_slot",
            sa.Integer(),
            server_default=sa.text("4"),
            nullable=False,
        ),
        sa.Column(
            "force_close_hours",
            sa.Integer(),
            server_default=sa.text("48"),
            nullable=False,
        ),
        sa.Column(
            "renotify_grace_minutes",
            sa.Integer(),
            server_default=sa.text("30"),
            nullable=False,
        ),
        sa.Column(
            "slot_reminder_minutes",
            sa.Integer(),
            server_default=sa.text("60"),
            nullable=False,
        ),
        # Audit columns last — the mixins' order, and the reason the whole
        # schema was squashed once already.
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
        sa.CheckConstraint(
            "jsonb_typeof(cancel_penalties_paise) = 'array' "
            "AND jsonb_array_length(cancel_penalties_paise) = 4",
            name="cancel_penalties_paise",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(bonus_bands_paise) = 'array' "
            "AND jsonb_array_length(bonus_bands_paise) = 4",
            name="bonus_bands_paise",
        ),
        sa.CheckConstraint(
            "cancel_penalty_cap_paise >= 0 AND cancel_penalty_cap_paise <= 100000000",
            name="cancel_penalty_cap_paise",
        ),
        sa.CheckConstraint(
            "ai_confidence_threshold >= 50 AND ai_confidence_threshold <= 95",
            name="ai_confidence_threshold",
        ),
        sa.CheckConstraint(
            "sla_warn_at_pct >= 1 AND sla_warn_at_pct <= 99", name="sla_warn_at_pct"
        ),
        sa.CheckConstraint(
            "slot_silence_hours >= 1 AND slot_silence_hours <= 72",
            name="slot_silence_hours",
        ),
        sa.CheckConstraint(
            "escalate_hours_before_slot >= 1 AND escalate_hours_before_slot <= 48",
            name="escalate_hours_before_slot",
        ),
        sa.CheckConstraint(
            "force_close_hours >= 1 AND force_close_hours <= 240",
            name="force_close_hours",
        ),
        sa.CheckConstraint(
            "renotify_grace_minutes >= 5 AND renotify_grace_minutes <= 720",
            name="renotify_grace_minutes",
        ),
        sa.CheckConstraint(
            "slot_reminder_minutes >= 5 AND slot_reminder_minutes <= 1440",
            name="slot_reminder_minutes",
        ),
        sa.CheckConstraint(
            "escalate_hours_before_slot < slot_silence_hours",
            name="escalate_before_silence",
        ),
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", name="uq_company_rules_company"),
    )

    conn = op.get_bind()

    # Every existing company gets the constants that were live a moment ago. The
    # column defaults ARE those constants, so naming only `company_id` is not a
    # shortcut — it is what keeps the two copies from disagreeing.
    conn.execute(
        sa.text(
            "INSERT INTO company_rules (company_id) "
            "SELECT id FROM companies "
            "WHERE NOT EXISTS ("
            "  SELECT 1 FROM company_rules r WHERE r.company_id = companies.id"
            ")"
        )
    )

    # Viewing the rules and changing them stop being one grant.
    conn.execute(
        sa.text(
            "INSERT INTO features (key, label, parent_key, sort_order, is_active) "
            "VALUES ('settings.edit', 'Edit Settings', 'settings.view', 91, true)"
        )
    )
    conn.execute(
        sa.text(
            "INSERT INTO role_feature_defaults (role, feature_id, enabled) "
            "SELECT unnest(CAST(:roles AS varchar[])), f.id, true "
            "FROM features f WHERE f.key = 'settings.edit'"
        ),
        {"roles": list(EDIT_ROLES)},
    )


def downgrade() -> None:
    conn = op.get_bind()

    # Order matters: the defaults and any per-company override reference the
    # feature row, so both go before it does.
    conn.execute(
        sa.text(
            "DELETE FROM role_feature_defaults WHERE feature_id IN "
            "(SELECT id FROM features WHERE key = 'settings.edit')"
        )
    )
    conn.execute(
        sa.text(
            "DELETE FROM company_role_features WHERE feature_id IN "
            "(SELECT id FROM features WHERE key = 'settings.edit')"
        )
    )
    conn.execute(sa.text("DELETE FROM features WHERE key = 'settings.edit'"))

    # Whatever any company had tuned is lost, and that is the honest outcome:
    # downgrading past this puts the numbers back in `Settings`, where there is
    # exactly one set of them for the whole deployment and nowhere to keep a
    # second company's answer.
    op.drop_table("company_rules")
