"""Travel allowance: a base for every technician, rules per franchisee,
a snapshot per accepted job, and the `travel` ledger kind.

Revision ID: 9e1b5d3c7a26
Revises: 7c4f2e9a1d58
Create Date: 2026-10-23

Task 10. What the five sections do:

1. `technician_profiles` gains the base location — six nullable columns, the
   coordinates both-or-neither inside the India box, the pincode FK RESTRICTing
   against the global master, and the setter FK going SET NULL into users.
2. `franchisee_travel_rules` — what each franchisee pays each technician type.
   Audit columns copied from 3b7e1f0a9c41's `_audit_columns` helper (this
   migration does not import it — no migration imports another's symbols).
3. Backfill — two TRAVEL_DEFAULTS rows per existing franchisee, soft-deleted
   ones included on purpose, so "exactly two rows per franchisee" is an
   invariant `verify.py` can state without a WHERE.
4. `tickets.accept_snapshot` — JSONB. No backfill: a ticket accepted before
   today has no snapshot, which reads as "nothing to pay", and the stamped
   defaults are ₹0 anyway.
5. The `travel` ledger kind — the kind CHECK widened by the e8b2f47c19d3
   helper (matched on 'penalty', NOT on 'kind'), plus the one-travel-per-ticket
   partial unique.

Downgrade REFUSES while any `travel` ledger row exists: those are payments, and
a downgrade would silently take that money back from technicians. Bases, rules
and snapshots are dropped without asking — a person can re-enter a base.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "9e1b5d3c7a26"
down_revision: Union[str, Sequence[str], None] = "7c4f2e9a1d58"
branch_labels = None
depends_on = None

_LEDGER_KINDS_OLD = "kind IN ('penalty', 'bonus', 'payout', 'reversal')"
_LEDGER_KINDS_NEW = "kind IN ('penalty', 'bonus', 'payout', 'reversal', 'travel')"

#: `app.core.travel.TRAVEL_DEFAULTS` on the day this shipped (TA4):
#: (free_km, step_km, paise_per_step, road_factor_pct, max_paise_per_job).
#: A copy, not an import — a migration must keep meaning what it meant.
_DEFAULTS = {
    "freelancer": (20, 1, 0, 130, 0),
    "employee": (30, 1, 0, 130, 0),
}


def _drop_ledger_kind_check() -> None:
    """Drop the `kind` CHECK on ledger_entries by whatever it is called.

    The `e8b2f47c19d3` helper, verbatim: matched on `'penalty'` because
    `reversal_points_back` mentions `kind` too. Task 11's `speed_penalty` will
    still match; never "simplify" the match to `'%kind%'`.
    """
    op.execute(
        """
        DO $$
        DECLARE target text;
        BEGIN
          SELECT conname INTO target
            FROM pg_constraint
           WHERE conrelid = 'ledger_entries'::regclass
             AND contype = 'c'
             AND pg_get_constraintdef(oid) LIKE '%''penalty''%';
          IF target IS NOT NULL THEN
            EXECUTE format('ALTER TABLE ledger_entries DROP CONSTRAINT %I', target);
          END IF;
        END $$;
        """
    )


def _audit_columns() -> list[sa.Column]:
    """The audit columns, exactly as 3b7e1f0a9c41 wrote them (Task 01) — same
    server defaults as `db.mixins` declares, `created_by`/`updated_by` NOT FKs."""
    return [
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
    ]


def upgrade() -> None:
    # ── 1. technician_profiles: the base ─────────────────────────────────────
    op.add_column("technician_profiles", sa.Column("base_latitude", sa.Float(), nullable=True))
    op.add_column("technician_profiles", sa.Column("base_longitude", sa.Float(), nullable=True))
    op.add_column("technician_profiles", sa.Column("base_pincode", sa.String(6), nullable=True))
    op.add_column("technician_profiles", sa.Column("base_source", sa.String(8), nullable=True))
    op.add_column(
        "technician_profiles",
        sa.Column("base_set_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "technician_profiles", sa.Column("base_set_by_user_id", sa.Uuid(), nullable=True)
    )
    op.create_foreign_key(
        "fk_technician_profiles_base_pincode_pincodes",
        "technician_profiles", "pincodes", ["base_pincode"], ["code"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_technician_profiles_base_set_by_user_id_users",
        "technician_profiles", "users", ["base_set_by_user_id"], ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_technician_profiles_base_pincode", "technician_profiles", ["base_pincode"])
    op.create_index(
        "ix_technician_profiles_base_set_by", "technician_profiles", ["base_set_by_user_id"]
    )
    # Bare names — the `ck_%(table_name)s_%(constraint_name)s` convention
    # prefixes them, exactly as every other CHECK on this table was made.
    op.create_check_constraint(
        "base_coordinates_both_or_neither", "technician_profiles",
        "(base_latitude IS NULL) = (base_longitude IS NULL) "
        "AND (base_latitude IS NULL OR (base_latitude BETWEEN 6 AND 38 "
        "AND base_longitude BETWEEN 68 AND 98))",
    )
    op.create_check_constraint(
        "base_source", "technician_profiles",
        "base_source IS NULL OR base_source IN ('pincode', 'gps', 'map', 'manual')",
    )
    op.create_check_constraint(
        "base_complete", "technician_profiles",
        "(base_latitude IS NULL) = (base_source IS NULL) "
        "AND (base_source IS NULL) = (base_set_at IS NULL)",
    )
    op.create_check_constraint(
        "base_pincode_iff_source", "technician_profiles",
        "(base_pincode IS NOT NULL) = (base_source IS NOT DISTINCT FROM 'pincode')",
    )

    # ── 2. franchisee_travel_rules ───────────────────────────────────────────
    # Constraint names inside create_table are the FULL DB names (op.f() pins
    # them against re-conventioning), the way 3b7e1f0a9c41 wrote its tables.
    op.create_table(
        "franchisee_travel_rules",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("franchisee_id", sa.Uuid(), nullable=False),
        sa.Column("technician_type", sa.String(16), nullable=False),
        sa.Column("free_km", sa.SmallInteger(), nullable=False),
        sa.Column("step_km", sa.SmallInteger(), nullable=False),
        sa.Column("paise_per_step", sa.Integer(), nullable=False),
        sa.Column("road_factor_pct", sa.SmallInteger(), nullable=False),
        sa.Column("max_paise_per_job", sa.Integer(), nullable=False),
        # audit columns LAST, exactly as IdMixin/AuditMixin declare them
        *_audit_columns(),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_franchisee_travel_rules")),
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"], ondelete="CASCADE",
            name=op.f("fk_franchisee_travel_rules_company_id_companies"),
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "franchisee_id"], ["franchisees.company_id", "franchisees.id"],
            ondelete="CASCADE", name="fk_franchisee_travel_rules_company_franchisee",
        ),
        sa.UniqueConstraint(
            "company_id", "franchisee_id", "technician_type",
            name="uq_franchisee_travel_rules_company_franchisee_type",
        ),
        sa.CheckConstraint("technician_type IN ('employee', 'freelancer')",
                           name=op.f("ck_franchisee_travel_rules_technician_type")),
        sa.CheckConstraint("free_km BETWEEN 0 AND 500",
                           name=op.f("ck_franchisee_travel_rules_free_km")),
        sa.CheckConstraint("step_km BETWEEN 1 AND 50",
                           name=op.f("ck_franchisee_travel_rules_step_km")),
        sa.CheckConstraint("paise_per_step BETWEEN 0 AND 1000000",
                           name=op.f("ck_franchisee_travel_rules_paise_per_step")),
        sa.CheckConstraint("road_factor_pct BETWEEN 100 AND 300",
                           name=op.f("ck_franchisee_travel_rules_road_factor_pct")),
        sa.CheckConstraint("max_paise_per_job BETWEEN 0 AND 10000000",
                           name=op.f("ck_franchisee_travel_rules_max_paise_per_job")),
    )

    # ── 3. backfill: two rows per existing franchisee (TA4) ──────────────────
    bind = op.get_bind()
    for ttype, (free_km, step_km, pps, pct, max_paise) in _DEFAULTS.items():
        bind.execute(
            sa.text(
                """
                INSERT INTO franchisee_travel_rules
                  (id, company_id, franchisee_id, technician_type, free_km, step_km,
                   paise_per_step, road_factor_pct, max_paise_per_job)
                SELECT gen_random_uuid(), f.company_id, f.id, :ttype, :free_km, :step_km,
                       :pps, :pct, :max_paise
                FROM franchisees f
                ON CONFLICT ON CONSTRAINT uq_franchisee_travel_rules_company_franchisee_type
                DO NOTHING
                """
            ),
            {"ttype": ttype, "free_km": free_km, "step_km": step_km,
             "pps": pps, "pct": pct, "max_paise": max_paise},
        )
    # Soft-deleted franchisees included on purpose: two rows per franchisee is
    # then an invariant verify.py can state without a WHERE.

    # ── 4. tickets.accept_snapshot ───────────────────────────────────────────
    op.add_column(
        "tickets",
        sa.Column("accept_snapshot", postgresql.JSONB(none_as_null=True), nullable=True),
    )
    # No backfill. A ticket accepted before today has no snapshot, which reads
    # as "nothing to pay" (index §3.5) — and the TA4 defaults are ₹0 anyway.

    # ── 5. ledger kind ───────────────────────────────────────────────────────
    _drop_ledger_kind_check()
    op.create_check_constraint("kind", "ledger_entries", _LEDGER_KINDS_NEW)
    op.create_index(
        "uq_ledger_entries_one_travel", "ledger_entries", ["company_id", "ticket_id"],
        unique=True, postgresql_where=sa.text("kind = 'travel'"),
    )


def downgrade() -> None:
    bind = op.get_bind()

    # Refuse rather than delete money — the e8b2f47c19d3 / f4b28d1a67c3 shape.
    # A base somebody re-enters in a minute; a payment's history, never.
    paid = bind.execute(
        sa.text("SELECT count(*) FROM ledger_entries WHERE kind = 'travel'")
    ).scalar()
    if paid:
        raise RuntimeError(
            f"{paid} travel allowance(s) have been credited. Downgrading would "
            "delete them and silently take that money back from technicians. "
            "Decide what should happen to it first."
        )

    op.drop_index("uq_ledger_entries_one_travel", table_name="ledger_entries")
    _drop_ledger_kind_check()
    op.create_check_constraint("kind", "ledger_entries", _LEDGER_KINDS_OLD)

    op.drop_column("tickets", "accept_snapshot")
    op.drop_table("franchisee_travel_rules")

    for name in ("base_pincode_iff_source", "base_complete", "base_source",
                 "base_coordinates_both_or_neither"):
        op.drop_constraint(name, "technician_profiles", type_="check")   # bare name
    op.drop_index("ix_technician_profiles_base_set_by", table_name="technician_profiles")
    op.drop_index("ix_technician_profiles_base_pincode", table_name="technician_profiles")
    op.drop_constraint("fk_technician_profiles_base_set_by_user_id_users",
                       "technician_profiles", type_="foreignkey")
    op.drop_constraint("fk_technician_profiles_base_pincode_pincodes",
                       "technician_profiles", type_="foreignkey")
    for col in ("base_set_by_user_id", "base_set_at", "base_source",
                "base_pincode", "base_longitude", "base_latitude"):
        op.drop_column("technician_profiles", col)