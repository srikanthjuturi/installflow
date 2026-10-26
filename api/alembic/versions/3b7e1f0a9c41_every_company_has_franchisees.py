"""Every company has franchisees

Until now every technician was a freelancer the company managed directly. From
this migration on, every company runs franchisees, and a franchisee runs the
technicians (RequirementDocs/franchisee/00-index.md F1–F5).

  * `franchisees` — one row per franchisee. Every company gets exactly one
    HOME franchisee: internal, permanent, named after the company verbatim
    (root AGENTS.md hard rule 6 forbids inventing copy — "Acme Home" would put
    a word into data nobody signed off), code `HOME` (stamped once, never
    recomputed, and `uq_franchisees_company_code` reserves the string so no
    later franchisee can ever be minted with it, whatever its own name
    derives to).
  * `franchisee_pincodes` — the pincodes a NON-home franchisee owns. Shipped
    EMPTY: the home owns "every pincode nobody else owns" by definition (F4),
    so there is nothing to insert for it, and no other franchisee exists yet
    to own anything else. It has no writer until Task 03 — api/AGENTS.md hard
    rule 8 (no table without a writer) is satisfied by that task landing in
    the same release train, not by this one.
  * Seven `franchisee_id` columns, nullable first, backfilled to each row's
    company's home, then tightened to NOT NULL on everything but
    `memberships` (which stays nullable until Task 02's three franchise
    roles exist to set it).
  * `technician_profiles.technician_type` / `technician_invites.technician_type`
    — every technician becomes a `freelancer` (F5), via the column's own
    server default, which is also why no explicit UPDATE is needed for it.

## Nothing visible changes today

A ticket raised five minutes after this runs is stamped by
`core.franchise.franchisee_for_pincode`, which — with no `franchisee_pincodes`
rows yet — always answers "the home". Every screen, every number, every push
reads exactly as it did yesterday (F5's own promise).

## `updated_at` is deliberately not touched by the backfill

This is not an edit anybody made to those rows — it is this migration
stamping a column that did not exist a moment ago. `ledger_entries` in
particular is "never edited" (see its own module docstring); if this UPDATE
touched `updated_at` a reader could mistake a schema change for someone
correcting a historical payout.

## The downgrade refuses to destroy what people entered

`downgrade_blockers` (PURE, unit-tested — §6 of the task doc) says why: any
franchisee other than the home, any `franchisee_pincodes` row, any login
acting for a franchisee, or any technician/invite typed `employee` is
something a later task's data that this revision's columns cannot hold
without being invented back from nothing. Remove them by hand first.

## Migrate production, then publish PROMPTLY

Once the five NOT NULL columns land, the OLD deployed API can no longer
insert a ticket, a technician, an invite, a ledger entry (so a customer
confirming closure fails) or a redemption — until the new code is live, each
of those fails as a clean 409 from `errors.py` and rolls back, nothing
half-written. Run the migration and the publish back to back, out of hours.
A company the OLD code creates in the gap has no home; `home_franchisee_id`
self-heals it on its own first stamped write (same pattern as `rules.load_rules`).

## Two vocabulary widenings ride along

Task 03's carve-out needs a `ticket_events` row of kind `franchisee_changed`
and a `notifications` row of kind `technician_moved`. Both CHECK-constrained
columns get exactly one new value apiece here, because 00-index.md §3.6 gives
these values to no other migration and Tasks 01–03 have to publish together
(index gate b2) — once `franchisee_id` is NOT NULL nothing downstream of it
can be a separate release.

Revision ID: 3b7e1f0a9c41
Revises: f9c2d8a3e17b
Create Date: 2026-10-16 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3b7e1f0a9c41"
down_revision: Union[str, Sequence[str], None] = "f9c2d8a3e17b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


#: Stamped with the company's home and NOT NULL afterwards.
_STAMPED = ("technician_profiles", "technician_invites", "tickets", "ledger_entries", "redemptions")

#: table -> (covering index name, columns). One composite FK each, named fk_<table>_company_franchisee.
_LINKS = {
    "memberships": ("ix_memberships_company_franchisee", ["company_id", "franchisee_id"]),
    "technician_profiles": ("ix_technician_profiles_company_franchisee", ["company_id", "franchisee_id"]),
    "technician_invites": ("ix_technician_invites_company_franchisee", ["company_id", "franchisee_id"]),
    "tickets": ("ix_tickets_company_franchisee", ["company_id", "franchisee_id"]),
    "ledger_entries": ("ix_ledger_entries_company_franchisee", ["company_id", "franchisee_id", "created_at"]),
    "redemptions": ("ix_redemptions_company_franchisee", ["company_id", "franchisee_id", "created_at"]),
}
_TYPED = ("technician_profiles", "technician_invites")

#: The two vocabularies exactly as the CHECK read at f9c2d8a3e17b — spelled out
#: here, never imported from the models (a later model edit must not silently
#: rewrite what this migration says the database looked like on the day it ran).
_OLD_EVENT_KINDS = (
    "'created', 'slot_requested', 'slot_confirmed', 'confirmation_sent', "
    "'status_changed', 'assigned', 'started', 'feedback_requested', "
    "'completed', 'feedback_received', 'reopened', 'serial_mismatch', "
    "'serial_corrected', 'reminded', 'customer_notified', 'escalated', "
    "'bonus_added', 'released', 'no_show', 'force_closed', 'rescheduled', "
    "'penalty_reversed'"
)
_NEW_EVENT_KINDS = _OLD_EVENT_KINDS + ", 'franchisee_changed'"

_OLD_NOTIFICATION_KINDS = (
    "'escalation', 'ai', 'serial_mismatch', 'force_close', 'slot', "
    "'technician_joined', 'job_started', 'invite_expired', 'assigned', "
    "'no_show', 'product_submitted', 'product_approved', 'product_rejected', "
    "'rescheduled', 'redemption', 'brand_submitted', 'brand_approved', "
    "'brand_rejected', 'upi_change', 'credits', 'recharge', 'vendor_credit', "
    "'vendor_payment', 'vendor_credit_request'"
)
_NEW_NOTIFICATION_KINDS = _OLD_NOTIFICATION_KINDS + ", 'technician_moved'"


def _audit_columns(*, soft_delete: bool) -> list[sa.Column]:
    cols = [
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
    ]
    if soft_delete:
        cols.append(sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    return cols


def upgrade() -> None:
    # ── 1. franchisees ────────────────────────────────────────────────────────
    op.create_table(
        "franchisees",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("code", sa.String(8), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("is_home", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("contact_name", sa.String(255), nullable=True),
        sa.Column("contact_phone", sa.String(20), nullable=True),
        sa.Column("contact_email", sa.String(255), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        *_audit_columns(soft_delete=True),
        sa.CheckConstraint("kind IN ('internal', 'external')", name=op.f("ck_franchisees_kind")),
        sa.CheckConstraint("code ~ '^[A-Z0-9]{2,8}$'", name=op.f("ck_franchisees_code")),
        sa.CheckConstraint("NOT is_home OR kind = 'internal'", name=op.f("ck_franchisees_home_is_internal")),
        sa.CheckConstraint(
            "NOT is_home OR (is_active AND deleted_at IS NULL)",
            name=op.f("ck_franchisees_home_is_permanent"),
        ),
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"],
            name=op.f("fk_franchisees_company_id_companies"), ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_franchisees")),
        # Its company_id prefix also covers the companies FK.
        sa.UniqueConstraint("company_id", "id", name="uq_franchisees_company_id_id"),
    )
    op.create_index(
        "uq_franchisees_one_home", "franchisees", ["company_id"], unique=True,
        postgresql_where=sa.text("is_home AND deleted_at IS NULL"),
    )
    op.create_index(
        "uq_franchisees_company_code", "franchisees", ["company_id", "code"], unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_franchisees_company_name_lower "
        "ON franchisees (company_id, lower(name)) WHERE deleted_at IS NULL"
    )

    # ── 2. franchisee_pincodes ────────────────────────────────────────────────
    op.create_table(
        "franchisee_pincodes",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("franchisee_id", sa.Uuid(), nullable=False),
        sa.Column("pincode", sa.String(6), nullable=False),
        *_audit_columns(soft_delete=False),
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"],
            name=op.f("fk_franchisee_pincodes_company_id_companies"), ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "franchisee_id"], ["franchisees.company_id", "franchisees.id"],
            name="fk_franchisee_pincodes_company_franchisee", ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["pincode"], ["pincodes.code"],
            name=op.f("fk_franchisee_pincodes_pincode_pincodes"), ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_franchisee_pincodes")),
        sa.UniqueConstraint("company_id", "pincode", name="uq_franchisee_pincodes_company_pincode"),
    )
    op.create_index(
        "ix_franchisee_pincodes_company_franchisee", "franchisee_pincodes", ["company_id", "franchisee_id"]
    )
    op.create_index("ix_franchisee_pincodes_pincode", "franchisee_pincodes", ["pincode"])

    # ── 3. one home per company — EVERY company, soft-deleted and suspended included, because their
    #       tickets and technicians still need a NOT NULL value. Same values as
    #       core.franchise.home_franchisee_fields(), which create_company uses from now on.
    op.execute(
        """
        INSERT INTO franchisees (company_id, name, code, kind, is_home, is_active, created_by)
        SELECT c.id, c.name, 'HOME', 'internal', true, true, c.created_by
        FROM companies c
        """
    )

    # ── 4. the columns, nullable first ────────────────────────────────────────
    for table in _LINKS:
        op.add_column(table, sa.Column("franchisee_id", sa.Uuid(), nullable=True))
    for table in _TYPED:
        # F5: every technician is a freelancer. The server default fills every existing row.
        op.add_column(
            table,
            sa.Column(
                "technician_type", sa.String(16),
                server_default=sa.text("'freelancer'"), nullable=False,
            ),
        )
        op.create_check_constraint(
            "technician_type", table, "technician_type IN ('employee', 'freelancer')"
        )  # BARE name

    # ── 5. stamp, then tighten. updated_at / updated_by are NOT touched: this is not an edit anybody made,
    #       and ledger_entries is "never edited".
    for table in _STAMPED:
        op.execute(
            f"""
            UPDATE {table} x SET franchisee_id = f.id
            FROM franchisees f
            WHERE f.company_id = x.company_id AND f.is_home
            """
        )
        op.alter_column(table, "franchisee_id", nullable=False)

    # ── 6. FKs and covering indexes AFTER the bulk UPDATE (cheaper than maintaining them through it).
    for table, (index, columns) in _LINKS.items():
        op.create_foreign_key(
            f"fk_{table}_company_franchisee", table, "franchisees",
            ["company_id", "franchisee_id"], ["company_id", "id"], ondelete="RESTRICT",
        )
        op.create_index(index, table, columns)

    # ── 7. the two vocabulary widenings (§3.3a) ────────────────────────────────
    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint("kind", "ticket_events", f"kind IN ({_NEW_EVENT_KINDS})")
    op.drop_constraint("kind", "notifications", type_="check")
    op.create_check_constraint("kind", "notifications", f"kind IN ({_NEW_NOTIFICATION_KINDS})")


def downgrade_blockers(counts: dict[str, int]) -> list[str]:
    """PURE — the sentences that stop a downgrade. Unit-tested (§6)."""
    messages = {
        "other_franchisees": "franchisee(s) other than the home were created",
        "franchisee_pincodes": "pincode assignment(s) exist",
        "franchise_memberships": "login(s) act for a franchisee",
        "employees": "technician(s) or invite(s) are typed 'employee'",
        "franchisee_changed_events": "ticket event(s) record a franchisee change",
        "technician_moved_notifications": "notification(s) record a technician move",
    }
    return [f"{counts[k]} {text}" for k, text in messages.items() if counts.get(k)]


def downgrade() -> None:
    bind = op.get_bind()
    counts = {
        "other_franchisees": bind.scalar(sa.text("SELECT count(*) FROM franchisees WHERE NOT is_home")),
        "franchisee_pincodes": bind.scalar(sa.text("SELECT count(*) FROM franchisee_pincodes")),
        "franchise_memberships": bind.scalar(
            sa.text("SELECT count(*) FROM memberships WHERE franchisee_id IS NOT NULL")
        ),
        "employees": bind.scalar(
            sa.text(
                "SELECT (SELECT count(*) FROM technician_profiles WHERE technician_type <> 'freelancer')"
                " + (SELECT count(*) FROM technician_invites WHERE technician_type <> 'freelancer')"
            )
        ),
        "franchisee_changed_events": bind.scalar(
            sa.text("SELECT count(*) FROM ticket_events WHERE kind = 'franchisee_changed'")
        ),
        "technician_moved_notifications": bind.scalar(
            sa.text("SELECT count(*) FROM notifications WHERE kind = 'technician_moved'")
        ),
    }
    blockers = downgrade_blockers(counts)
    if blockers:
        raise RuntimeError(
            "Refusing to downgrade 3b7e1f0a9c41 — it would lose data: "
            + "; ".join(blockers) + ". Remove them by hand first."
        )

    # Restore the two CHECKs to exactly what they were at f9c2d8a3e17b.
    op.drop_constraint("kind", "notifications", type_="check")
    op.create_check_constraint("kind", "notifications", f"kind IN ({_OLD_NOTIFICATION_KINDS})")
    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint("kind", "ticket_events", f"kind IN ({_OLD_EVENT_KINDS})")

    for table, (index, _columns) in reversed(list(_LINKS.items())):
        op.drop_index(index, table_name=table)
        op.drop_constraint(f"fk_{table}_company_franchisee", table, type_="foreignkey")
        op.drop_column(table, "franchisee_id")
    for table in _TYPED:
        op.drop_constraint("technician_type", table, type_="check")  # BARE name, both directions
        op.drop_column(table, "technician_type")
    op.drop_index("ix_franchisee_pincodes_pincode", table_name="franchisee_pincodes")
    op.drop_index("ix_franchisee_pincodes_company_franchisee", table_name="franchisee_pincodes")
    op.drop_table("franchisee_pincodes")
    op.execute("DROP INDEX IF EXISTS uq_franchisees_company_name_lower")
    op.drop_index("uq_franchisees_company_code", table_name="franchisees")
    op.drop_index("uq_franchisees_one_home", table_name="franchisees")
    op.drop_table("franchisees")
