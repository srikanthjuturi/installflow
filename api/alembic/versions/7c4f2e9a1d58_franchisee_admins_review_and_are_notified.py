"""A franchisee admin reviews and is notified

Tasks 01–04 stamped every technician, ticket, ledger row and redemption with a
`franchisee_id`. This migration makes it possible to ADDRESS a row to the
people who manage that franchisee (RequirementDocs/franchisee/05 §3):

  * `notifications.franchisee_id` — the franchisee the row is ABOUT. NULL for
    the staff-only events, and NULL is also what keeps every company-wide row
    out of a franchise reader's feed (Task 02 closed that leak; Task 05 §4.8
    replaces its fail-closed `sql_false()` with the real rule). Composite FK to
    `franchisees (company_id, id)` — Task 01's `uq_franchisees_company_id_id` —
    CASCADE, like the vendor link: a removed franchisee's bells have nobody
    left to read them.
  * `audience` += `franchisee_admin`; the CHECK is REBUILT listing every
    earlier value, exactly as `3b7e1f0a9c41` rebuilt `kind`. Alongside it the
    new `franchisee_audience` CHECK: an addressed franchise row must say which
    franchisee — the audience says which KIND of reader, the id says which one,
    the pairing `vendor` already makes (and Postgres cannot express on it,
    because a vendor row MAY carry a NULL `audience`).
  * `upi_change_requests.reviewer_role` += `franchisee_admin` — the reviewer of
    a non-home technician's UPI change is their franchisee's own admin (F7);
    the home keeps today's AM → RH → NH → Admin chain (F8).
  * `ledger_entries.technician_type` — the type the technician WAS when the
    money moved, stamped beside `franchisee_id` (§3.3). Task 06 answers
    "redeemable by UPI" (freelancer money) and "which goes on the salary
    statement" (employee money) with a plain WHERE on it; the current profile
    type cannot answer either for an old row, because the type can change (T1).
    Backfilled from the profile — every row is `freelancer` after Task 01's F5
    backfill, but reading the profile keeps it right whatever ran first. No
    server default: a writer that forgets it must fail on NOT NULL, not
    silently file salary money as redeemable. No new index — Task 01's
    `ix_ledger_entries_company_franchisee (company_id, franchisee_id,
    created_at)` already serves the per-franchisee pool, ledger list and
    month statement.

CHECK names are passed BARE to both calls: `NAMING_CONVENTION` in
`db/base_class.py` prefixes `ck_%(table_name)s_` on the way out as well as in.
`notifications.kind` and `ticket_events.kind` are NOT touched — their widenings
(`technician_moved`, `franchisee_changed`) are `3b7e1f0a9c41`'s, so Task 03
depends on nothing here.

## Nothing else visible changes today

`upi_reviewer` still answers the staff chain for every existing technician —
every one of them is home (F5) — and no bell is addressed to a franchisee admin
until a writer of Task 05's code raises one. The migration alone moves nothing.

## The downgrade refuses to lose a fact

`downgrade_blockers` (PURE, unit-tested — §6) names them in words first:
`franchisee_admin` rows in either CHECK are data a narrowed vocabulary cannot
hold, and an `employee` ledger row dropped without its column would be silently
redeemable by UPI. The one thing the downgrade MAY throw away is a bell
(`notifications WHERE audience = 'franchisee_admin'`) — a bell is a work item,
not a record; the same call `b8e3f14a9c27`-shaped migrations have always made
for `vendor`.

Revision ID: 7c4f2e9a1d58
Revises: 5d2a8c6e0b13
Create Date: 2026-10-21 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7c4f2e9a1d58"
down_revision: Union[str, Sequence[str], None] = "5d2a8c6e0b13"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

#: The audience vocabulary exactly as the CHECK read at 5d2a8c6e0b13 — spelled
#: out, never imported from the models (a later model edit must not silently
#: rewrite what this migration says the database looked like on the day it ran).
_OLD_AUDIENCE = (
    "audience IS NULL OR audience IN ('payers', 'area_manager', 'regional_head', "
    "'national_head', 'admin', 'billing', 'vendor')"
)
_NEW_AUDIENCE = (
    "audience IS NULL OR audience IN ('payers', 'area_manager', 'regional_head', "
    "'national_head', 'admin', 'billing', 'vendor', 'franchisee_admin')"
)

_OLD_REVIEWER_ROLE = (
    "reviewer_role IN ('area_manager', 'regional_head', 'national_head', 'admin')"
)
_NEW_REVIEWER_ROLE = (
    "reviewer_role IN ('area_manager', 'regional_head', 'national_head', "
    "'admin', 'franchisee_admin')"
)


def upgrade() -> None:
    # ── 1. notifications: the column, then the widened vocabulary ─────────────
    op.add_column("notifications", sa.Column("franchisee_id", sa.Uuid(), nullable=True))
    op.drop_constraint("audience", "notifications", type_="check")
    op.create_check_constraint("audience", "notifications", _NEW_AUDIENCE)
    op.create_check_constraint(
        "franchisee_audience",
        "notifications",
        "audience IS DISTINCT FROM 'franchisee_admin' OR franchisee_id IS NOT NULL",
    )
    op.create_foreign_key(
        "fk_notifications_company_franchisee",
        "notifications",
        "franchisees",
        ["company_id", "franchisee_id"],
        ["company_id", "id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_notifications_company_franchisee",
        "notifications",
        ["company_id", "franchisee_id"],
    )

    # ── 2. upi_change_requests: the franchisee admin joins the reviewer chain ──
    op.drop_constraint("reviewer_role", "upi_change_requests", type_="check")
    op.create_check_constraint("reviewer_role", "upi_change_requests", _NEW_REVIEWER_ROLE)

    # ── 3. ledger_entries: stamp the technician's type onto the money (§3.3) ──
    op.add_column(
        "ledger_entries",
        sa.Column("technician_type", sa.String(16), nullable=True),
    )
    op.execute(
        """
        UPDATE ledger_entries le SET technician_type = tp.technician_type
        FROM technician_profiles tp
        WHERE tp.company_id = le.company_id AND tp.id = le.technician_id
        """
    )
    op.alter_column("ledger_entries", "technician_type", nullable=False)
    op.create_check_constraint(
        "technician_type",
        "ledger_entries",
        "technician_type IN ('employee', 'freelancer')",
    )


def downgrade_blockers(upi_reviews: int, employee_entries: int) -> list[str]:
    """PURE — the sentences that stop a downgrade. Unit-tested (§6)."""
    blockers = []
    if upi_reviews:
        blockers.append(
            f"{upi_reviews} UPI change request(s) are addressed to a franchisee admin; "
            "narrowing the CHECK would make them unstorable. Decide them first."
        )
    if employee_entries:
        blockers.append(
            f"{employee_entries} ledger entry(ies) are employee money; dropping their "
            "column would let salary money be redeemed by UPI."
        )
    return blockers


def downgrade() -> None:
    bind = op.get_bind()
    blockers = downgrade_blockers(
        bind.scalar(sa.text(
            "SELECT count(*) FROM upi_change_requests WHERE reviewer_role = 'franchisee_admin'"
        )),
        bind.scalar(sa.text(
            "SELECT count(*) FROM ledger_entries WHERE technician_type = 'employee'"
        )),
    )
    if blockers:
        raise RuntimeError(
            "Refusing to downgrade 7c4f2e9a1d58 — it would lose data: "
            + "; ".join(blockers)
        )

    # Bells, not records — the one thing here that MAY be thrown away (§3.4).
    bind.execute(sa.text("DELETE FROM notifications WHERE audience = 'franchisee_admin'"))

    # ── notifications back to what it was ─────────────────────────────────────
    op.drop_constraint("franchisee_audience", "notifications", type_="check")
    op.drop_constraint("audience", "notifications", type_="check")
    op.create_check_constraint("audience", "notifications", _OLD_AUDIENCE)
    op.drop_index(
        "ix_notifications_company_franchisee", table_name="notifications"
    )
    op.drop_constraint(
        "fk_notifications_company_franchisee", "notifications", type_="foreignkey"
    )
    op.drop_column("notifications", "franchisee_id")

    # ── upi_change_requests back to the staff chain ───────────────────────────
    op.drop_constraint("reviewer_role", "upi_change_requests", type_="check")
    op.create_check_constraint("reviewer_role", "upi_change_requests", _OLD_REVIEWER_ROLE)

    # ── ledger_entries loses the stream ───────────────────────────────────────
    op.drop_constraint("technician_type", "ledger_entries", type_="check")  # BARE name
    op.drop_column("ledger_entries", "technician_type")