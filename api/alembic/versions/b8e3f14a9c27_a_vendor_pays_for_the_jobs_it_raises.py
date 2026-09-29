"""A vendor pays for the jobs it raises, against a credit line

`product_models.vendor_price_paise` has been stamped onto every ticket since
intake existed, and its own comment calls it "what the vendor is charged for
asking" — but nothing has ever charged a vendor. The technician's half of that
pair becomes a `payout` ledger entry when a job closes; the vendor's half went
nowhere. This is the other half.

All in one revision per hard rule 8:

  * `companies.upi_id` / `upi_name` — where this company's VENDORS send what
    they owe it. `platform_settings` carries the same pair one level up.
  * `company_rules.vendor_credit_limit_paise` — the line a new vendor is
    stamped with. 5,00,000 paise (5,000 rupees).
  * `vendors.credit_limit_paise` — that vendor's own line, stamped at creation
    so a company raising the house default does not silently extend everybody.
  * `vendor_credit_entries` — append-only; what a vendor owes is their sum.
    `charge` (a ticket closed), `payment` (somebody confirmed money arrived).
  * `vendor_payments` — the vendor claims it paid, with a UTR and a screenshot;
    an Admin or National Head confirms or rejects. One open per vendor.
  * `vendor_credit_requests` — the other way out of a used-up line: ask for a
    bigger one. One pending per vendor.
  * `notifications.kind` gains `vendor_credit`, `vendor_payment` and
    `vendor_credit_request`; `notifications.audience` gains `vendor`, the one
    audience that narrows AWAY from staff — see `models/notification.py`.
  * Features `vendors.credit` (Admin, National Head) and `vendor.credit` (the
    vendor itself, and deliberately not its sub-users).

## Every existing vendor gets a line, and NOTHING is billed retroactively

Tickets already closed are deliberately NOT charged. A backfill would bill
vendors for months of delivered work they were never told was billable, and
there is no honest way to tell them after the fact. Nothing is owed on day one;
billing starts from the next closure.

But a vendor's room is `limit - owed - RESERVED`, and the reservation is a live
sum over its open tickets rather than a backfill. So each existing vendor's line
starts at 5,000 rupees PLUS what its open tickets already commit — otherwise a
vendor with work in flight would be refused its next ticket on the day this
ships, for a debt nobody had told it about. The default is the room it has for
NEW work, which is what the number means from here on.

The column's database default is dropped afterwards: the value is stamped by
`create_vendor` from the company's rule, and a lingering default would paper over
the day that stops happening.

## The downgrade refuses to destroy billing history

Once a ticket has been billed or a payment asked for, dropping these tables
would erase what a vendor paid and owes. It stops and says so.

Revision ID: b8e3f14a9c27
Revises: d3b70c5e1f94
Create Date: 2026-09-28 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b8e3f14a9c27"
down_revision: Union[str, Sequence[str], None] = "d3b70c5e1f94"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


#: As the database stands before this revision — spelled out, not imported, so
#: this file keeps working when the tuples in `models/notification.py` move on.
_NOTIFICATIONS = (
    "'escalation', 'ai', 'serial_mismatch', 'force_close', 'slot', "
    "'technician_joined', 'job_started', 'invite_expired', 'assigned', "
    "'no_show', 'product_submitted', 'product_approved', 'product_rejected', "
    "'rescheduled', 'redemption', 'brand_submitted', 'brand_approved', "
    "'brand_rejected', 'upi_change', 'credits', 'recharge'"
)
_NEW_NOTIFICATIONS = "'vendor_credit', 'vendor_payment', 'vendor_credit_request'"

_AUDIENCES = (
    "'payers', 'area_manager', 'regional_head', 'national_head', 'admin', "
    "'billing'"
)

#: What the platform ships with: 5,000 rupees. Written out rather than imported
#: from `rules.DEFAULTS`, which may say something else by the time this runs.
_VENDOR_CREDIT_LIMIT_PAISE = 500000

#: One crore rupees — `rules.LIMITS["vendor_credit_limit_paise"]`, likewise
#: spelled out. High on purpose: it is a typo guard, not a policy.
_LIMIT_CEILING = 1000000000

#: UPI's per-transaction cap, the same one a redemption and a recharge carry.
_PAYMENT_MAX_PAISE = 10000000

_VPA_CHECK = "position('@' in {col}) > 1 AND {col} !~ '\\s' AND length({col}) >= 3"

#: Staff: manage a vendor's line, confirm its payments, decide its requests.
#: Seeded to the two roles that may, and the API adds a National-Head rank floor
#: no per-company Feature Access override can lift — a payment is money.
_STAFF_FEATURE = "vendors.credit"
_STAFF_ROLES = ("admin", "national_head")

#: The vendor's own Credit page, and paying from it. `vendor` only, NOT
#: `vendor_user` — the line `vendor.users` and `vendor.catalogue` already draw:
#: a sub-user raises tickets, and settling with the company is a vendor-admin
#: act. One Feature Access row widens it per company, with no deploy.
_PORTAL_FEATURE = "vendor.credit"
_PORTAL_ROLES = ("vendor",)


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


def _seed_feature(
    bind, *, key: str, label: str, parent: str, sort: int, roles: Sequence[str]
) -> None:
    """Idempotent: `WHERE NOT EXISTS`, so a re-run adds nothing twice.

    `sort_order` is not unique and never has been — 87 already holds two keys —
    so a new child sharing its parent's neighbourhood is normal rather than a
    collision to route around.
    """
    bind.execute(
        sa.text(
            """
            INSERT INTO features (key, label, parent_key, sort_order)
            SELECT CAST(:key AS varchar), CAST(:label AS varchar),
                   CAST(:parent AS varchar), CAST(:sort AS integer)
            WHERE NOT EXISTS (SELECT 1 FROM features WHERE key = :key)
            """
        ),
        {"key": key, "label": label, "parent": parent, "sort": sort},
    )
    for role in roles:
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
            {"role": role, "key": key},
        )


def upgrade() -> None:
    # ── where a vendor pays its company ───────────────────────────────────────
    op.add_column("companies", sa.Column("upi_id", sa.String(256), nullable=True))
    op.add_column("companies", sa.Column("upi_name", sa.String(120), nullable=True))
    op.create_check_constraint(
        "upi_id",
        "companies",
        f"upi_id IS NULL OR ({_VPA_CHECK.format(col='upi_id')})",
    )
    # An address with no name to check it against, or a name with nowhere to
    # pay, is half a payee.
    op.create_check_constraint(
        "upi_pair", "companies", "(upi_id IS NULL) = (upi_name IS NULL)"
    )

    # ── the house default, and each vendor's own line ─────────────────────────
    op.add_column(
        "company_rules",
        sa.Column(
            "vendor_credit_limit_paise",
            sa.Integer(),
            nullable=False,
            server_default=sa.text(str(_VENDOR_CREDIT_LIMIT_PAISE)),
        ),
    )
    op.create_check_constraint(
        "vendor_credit_limit_paise",
        "company_rules",
        f"vendor_credit_limit_paise >= 0 "
        f"AND vendor_credit_limit_paise <= {_LIMIT_CEILING}",
    )

    op.add_column(
        "vendors",
        sa.Column(
            "credit_limit_paise",
            sa.Integer(),
            nullable=False,
            server_default=sa.text(str(_VENDOR_CREDIT_LIMIT_PAISE)),
        ),
    )
    # ...and then room for the work each of them ALREADY has in flight.
    #
    # This is the one part of this migration that is not obvious, and leaving it
    # out would have shipped a day-one outage. A vendor's `available` is
    # `limit - used - reserved`, and `reserved` is a LIVE sum over its open
    # tickets — not a backfill. So a vendor holding a hundred open jobs starts
    # with all of them reserved against a line that has never seen a payment, and
    # its very next ticket is refused for a debt it was never told about. On the
    # development database that was four vendors out of six, one of them by a
    # factor of six hundred.
    #
    # So each existing vendor's line starts at the default PLUS whatever its open
    # tickets already commit. Nothing is owed (no charges are backfilled) and
    # nothing in flight is retro-blocked; the default is the room they have for
    # new work, which is what the number means from here on. A company that wants
    # a tighter line sets it on the Vendors screen.
    #
    # Only existing vendors get this. A vendor created after today is stamped
    # from the company's rule alone, because it has no tickets to accommodate.
    # `LEAST` so no dataset can fail the CHECK below and take the whole migration
    # with it. A vendor whose in-flight work genuinely exceeds the ceiling lands
    # ON it and stays blocked until somebody looks — which is the right outcome
    # for a number that large, and vastly better than a deploy that stops here.
    op.execute(
        f"""
        UPDATE vendors v
           SET credit_limit_paise = LEAST(
                 {_LIMIT_CEILING},
                 v.credit_limit_paise + COALESCE((
                   SELECT SUM(t.vendor_price_paise) FROM tickets t
                    WHERE t.company_id = v.company_id
                      AND t.vendor_id = v.id
                      AND t.status NOT IN ('Closed', 'Force-Closed', 'Cancelled')
                 ), 0)
               )
        """
    )
    # The default did its one job — giving every existing vendor a line. Dropped
    # now, because the value is STAMPED by `vendors.service.create_vendor` from
    # the company's rule, and a default left here would silently supply a number
    # the day that stops happening.
    op.alter_column("vendors", "credit_limit_paise", server_default=None)
    op.create_check_constraint(
        "credit_limit_paise",
        "vendors",
        f"credit_limit_paise >= 0 AND credit_limit_paise <= {_LIMIT_CEILING}",
    )

    # ── vendor_payments ───────────────────────────────────────────────────────
    #
    # Before `vendor_credit_entries`, which carries a composite FK to it.
    op.create_table(
        "vendor_payments",
        sa.Column(
            "id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("vendor_id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("amount_paise", sa.Integer(), nullable=False),
        # NULL on a staff record: money that came by NEFT went to no UPI address,
        # and a company that never set one can still clear a vendor's line.
        sa.Column("upi_id", sa.String(256), nullable=True),
        sa.Column("payee_name", sa.String(120), nullable=True),
        sa.Column("requested_by_label", sa.String(120), nullable=True),
        # Who started it, and which rules the row therefore obeys — see the model.
        sa.Column(
            "source", sa.String(16), server_default=sa.text("'vendor'"), nullable=False
        ),
        sa.Column("method", sa.String(32), nullable=True),
        sa.Column("received_on", sa.Date(), nullable=True),
        sa.Column("note", sa.String(255), nullable=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("claimed_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("claimed_by_label", sa.String(120), nullable=True),
        sa.Column("utr", sa.String(35), nullable=True),
        sa.Column("proof_blob_name", sa.String(255), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("confirmed_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("confirmed_by_label", sa.String(120), nullable=True),
        sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejected_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("rejected_by_label", sa.String(120), nullable=True),
        sa.Column("reject_reason", sa.String(160), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_by_label", sa.String(120), nullable=True),
        *_audit_columns(),
        sa.PrimaryKeyConstraint("id", name="pk_vendor_payments"),
        sa.ForeignKeyConstraint(
            ["company_id"],
            ["companies.id"],
            name="fk_vendor_payments_company_id_companies",
            ondelete="CASCADE",
        ),
        # RESTRICT, like `vendor_brands`: a vendor is soft-deleted, and a payment
        # it made is a fact about money.
        sa.ForeignKeyConstraint(
            ["company_id", "vendor_id"],
            ["vendors.company_id", "vendors.id"],
            name="fk_vendor_payments_company_vendor",
            ondelete="RESTRICT",
        ),
        # The composite FK target for `vendor_credit_entries`. TOTAL — a partial
        # index cannot be a foreign key target.
        sa.UniqueConstraint("company_id", "id", name="uq_vendor_payments_company_id_id"),
        sa.UniqueConstraint("company_id", "code", name="uq_vendor_payments_company_code"),
        sa.CheckConstraint("source IN ('vendor', 'staff')", name="source"),
        # NOT restricted to whole rupees, unlike `credit_recharges` — the model
        # says why: this is a debt, not a count of indivisible credits, and a
        # whole-rupee rule left a sub-rupee residue nobody could ever pay off.
        #
        # The UPI cap binds the VENDOR's flow only: it is a fact about what one QR
        # can carry, not about what a vendor may owe, and capping a recorded NEFT
        # would file one real transfer as eleven fictional ones.
        sa.CheckConstraint(
            f"amount_paise > 0 "
            f"AND (source = 'staff' OR amount_paise <= {_PAYMENT_MAX_PAISE})",
            name="amount_paise",
        ),
        sa.CheckConstraint(
            f"upi_id IS NULL OR ({_VPA_CHECK.format(col='upi_id')})", name="upi_id"
        ),
        sa.CheckConstraint(
            "source <> 'vendor' OR (upi_id IS NOT NULL AND payee_name IS NOT NULL)",
            name="vendor_flow_has_payee",
        ),
        # A staff record IS the confirmation — born decided, and final like every
        # other confirmed payment here.
        sa.CheckConstraint(
            "source <> 'staff' "
            "OR (claimed_at IS NOT NULL AND confirmed_at IS NOT NULL "
            "AND method IS NOT NULL AND received_on IS NOT NULL)",
            name="staff_record_is_complete",
        ),
        sa.CheckConstraint(
            "claimed_at IS NOT NULL OR (utr IS NULL AND proof_blob_name IS NULL)",
            name="unclaimed_has_no_proof",
        ),
        # A VENDOR's claim is the UTR AND the screenshot. A staff record needs
        # neither: cash carries no reference, and the bank statement it was read
        # off is not ours to attach.
        sa.CheckConstraint(
            "source <> 'vendor' OR claimed_at IS NULL "
            "OR (utr IS NOT NULL AND proof_blob_name IS NOT NULL)",
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
    )
    op.create_index(
        "uq_vendor_payments_one_open",
        "vendor_payments",
        ["company_id", "vendor_id"],
        unique=True,
        postgresql_where=sa.text(
            "confirmed_at IS NULL AND rejected_at IS NULL AND cancelled_at IS NULL"
        ),
    )
    op.create_index(
        "ix_vendor_payments_company_vendor_created",
        "vendor_payments",
        ["company_id", "vendor_id", "created_at"],
    )
    op.create_index(
        "ix_vendor_payments_waiting",
        "vendor_payments",
        ["company_id", "claimed_at"],
        postgresql_where=sa.text(
            "claimed_at IS NOT NULL AND confirmed_at IS NULL AND rejected_at IS NULL"
        ),
    )
    # Scoped to the company, unlike the platform's global one: there the payee is
    # always the platform, here it is the company, and a vendor paying two of
    # them must not look like the same money claimed twice.
    op.create_index(
        "uq_vendor_payments_credited_utr",
        "vendor_payments",
        ["company_id", "utr"],
        unique=True,
        postgresql_where=sa.text("confirmed_at IS NOT NULL"),
    )

    # ── vendor_credit_requests ────────────────────────────────────────────────
    op.create_table(
        "vendor_credit_requests",
        sa.Column(
            "id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("vendor_id", sa.Uuid(), nullable=False),
        sa.Column("current_limit_paise", sa.Integer(), nullable=False),
        sa.Column("requested_limit_paise", sa.Integer(), nullable=False),
        sa.Column("note", sa.String(500), nullable=True),
        sa.Column(
            "status", sa.String(16), server_default=sa.text("'pending'"), nullable=False
        ),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("granted_limit_paise", sa.Integer(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("decided_by_label", sa.String(120), nullable=True),
        sa.Column("reject_reason", sa.String(160), nullable=True),
        *_audit_columns(),
        sa.PrimaryKeyConstraint("id", name="pk_vendor_credit_requests"),
        sa.ForeignKeyConstraint(
            ["company_id"],
            ["companies.id"],
            name="fk_vendor_credit_requests_company_id_companies",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "vendor_id"],
            ["vendors.company_id", "vendors.id"],
            name="fk_vendor_credit_requests_company_vendor",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected', 'cancelled')", name="status"
        ),
        sa.CheckConstraint(
            f"current_limit_paise >= 0 AND current_limit_paise <= {_LIMIT_CEILING}",
            name="current_limit_paise",
        ),
        sa.CheckConstraint(
            f"requested_limit_paise > current_limit_paise "
            f"AND requested_limit_paise <= {_LIMIT_CEILING}",
            name="requested_limit_paise",
        ),
        sa.CheckConstraint(
            "(status = 'pending') = (decided_at IS NULL)", name="decided_when_closed"
        ),
        sa.CheckConstraint(
            "(decided_at IS NULL) = (decided_by_user_id IS NULL)",
            name="decided_by_with_decided_at",
        ),
        sa.CheckConstraint(
            "(status = 'rejected') = (reject_reason IS NOT NULL)",
            name="rejection_has_reason",
        ),
        sa.CheckConstraint(
            "(status = 'approved') = (granted_limit_paise IS NOT NULL)",
            name="granted_only_on_approved",
        ),
        sa.CheckConstraint(
            f"granted_limit_paise IS NULL OR (granted_limit_paise >= 0 "
            f"AND granted_limit_paise <= {_LIMIT_CEILING})",
            name="granted_limit_paise",
        ),
        sa.CheckConstraint(
            "status <> 'pending' OR submitted_at IS NOT NULL",
            name="pending_was_submitted",
        ),
    )
    op.create_index(
        "uq_vendor_credit_requests_one_pending",
        "vendor_credit_requests",
        ["company_id", "vendor_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_index(
        "ix_vendor_credit_requests_company_vendor",
        "vendor_credit_requests",
        ["company_id", "vendor_id"],
    )

    # ── vendor_credit_entries ─────────────────────────────────────────────────
    #
    # Last: composite FKs to vendors, tickets AND vendor_payments.
    op.create_table(
        "vendor_credit_entries",
        sa.Column(
            "id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("vendor_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("amount_paise", sa.Integer(), nullable=False),
        sa.Column("ticket_id", sa.Uuid(), nullable=True),
        sa.Column("payment_id", sa.Uuid(), nullable=True),
        *_audit_columns(),
        sa.PrimaryKeyConstraint("id", name="pk_vendor_credit_entries"),
        sa.ForeignKeyConstraint(
            ["company_id"],
            ["companies.id"],
            name="fk_vendor_credit_entries_company_id_companies",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "vendor_id"],
            ["vendors.company_id", "vendors.id"],
            name="fk_vendor_credit_entries_company_vendor",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "ticket_id"],
            ["tickets.company_id", "tickets.id"],
            name="fk_vendor_credit_entries_company_ticket",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "payment_id"],
            ["vendor_payments.company_id", "vendor_payments.id"],
            name="fk_vendor_credit_entries_company_payment",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint("kind IN ('charge', 'payment')", name="kind"),
        sa.CheckConstraint("amount_paise > 0", name="amount_paise"),
        sa.CheckConstraint(
            "(kind = 'charge') = (ticket_id IS NOT NULL)", name="ticket_link"
        ),
        sa.CheckConstraint(
            "(kind = 'payment') = (payment_id IS NOT NULL)", name="payment_link"
        ),
    )
    # One charge per ticket and one credit per payment, whatever re-runs. Each
    # partial unique is also the covering index for its foreign key.
    op.create_index(
        "uq_vendor_credit_entries_company_ticket",
        "vendor_credit_entries",
        ["company_id", "ticket_id"],
        unique=True,
        postgresql_where=sa.text("ticket_id IS NOT NULL"),
    )
    op.create_index(
        "uq_vendor_credit_entries_company_payment",
        "vendor_credit_entries",
        ["company_id", "payment_id"],
        unique=True,
        postgresql_where=sa.text("payment_id IS NOT NULL"),
    )
    op.create_index(
        "ix_vendor_credit_entries_company_vendor_created",
        "vendor_credit_entries",
        ["company_id", "vendor_id", "created_at"],
    )

    # ── notifications ─────────────────────────────────────────────────────────
    op.drop_constraint("kind", "notifications", type_="check")
    op.create_check_constraint(
        "kind",
        "notifications",
        f"kind IN ({_NOTIFICATIONS}, {_NEW_NOTIFICATIONS})",
    )
    op.drop_constraint("audience", "notifications", type_="check")
    op.create_check_constraint(
        "audience",
        "notifications",
        f"audience IS NULL OR audience IN ({_AUDIENCES}, 'vendor')",
    )

    # ── the features ──────────────────────────────────────────────────────────
    bind = op.get_bind()
    _seed_feature(
        bind,
        key=_STAFF_FEATURE,
        label="Vendor Credit",
        parent="vendors.view",
        sort=89,
        roles=_STAFF_ROLES,
    )
    _seed_feature(
        bind,
        key=_PORTAL_FEATURE,
        label="Vendor Credit & Payments",
        parent="vendor.portal",
        sort=98,
        roles=_PORTAL_ROLES,
    )


def downgrade() -> None:
    bind = op.get_bind()
    billed = bind.execute(
        sa.text(
            "SELECT (SELECT count(*) FROM vendor_credit_entries) "
            "+ (SELECT count(*) FROM vendor_payments) "
            "+ (SELECT count(*) FROM vendor_credit_requests)"
        )
    ).scalar_one()
    if billed:
        raise RuntimeError(
            f"{billed} vendor credit entr(ies), payment(s) or request(s) exist. "
            "Downgrading would erase what vendors owe and have paid."
        )

    for key in (_PORTAL_FEATURE, _STAFF_FEATURE):
        bind.execute(
            sa.text(
                "DELETE FROM role_feature_defaults WHERE feature_id IN "
                "(SELECT id FROM features WHERE key = :key)"
            ),
            {"key": key},
        )
        bind.execute(sa.text("DELETE FROM features WHERE key = :key"), {"key": key})

    # Rows carrying a kind or audience this revision added must go before the
    # CHECKs narrow again, or the constraint cannot be created.
    bind.execute(
        sa.text(f"DELETE FROM notifications WHERE kind IN ({_NEW_NOTIFICATIONS})")
    )
    bind.execute(sa.text("UPDATE notifications SET audience = NULL WHERE audience = 'vendor'"))
    op.drop_constraint("audience", "notifications", type_="check")
    op.create_check_constraint(
        "audience", "notifications", f"audience IS NULL OR audience IN ({_AUDIENCES})"
    )
    op.drop_constraint("kind", "notifications", type_="check")
    op.create_check_constraint(
        "kind", "notifications", f"kind IN ({_NOTIFICATIONS})"
    )

    op.drop_index("ix_vendor_credit_entries_company_vendor_created", table_name="vendor_credit_entries")
    op.drop_index("uq_vendor_credit_entries_company_payment", table_name="vendor_credit_entries")
    op.drop_index("uq_vendor_credit_entries_company_ticket", table_name="vendor_credit_entries")
    op.drop_table("vendor_credit_entries")

    op.drop_index("ix_vendor_credit_requests_company_vendor", table_name="vendor_credit_requests")
    op.drop_index("uq_vendor_credit_requests_one_pending", table_name="vendor_credit_requests")
    op.drop_table("vendor_credit_requests")

    op.drop_index("uq_vendor_payments_credited_utr", table_name="vendor_payments")
    op.drop_index("ix_vendor_payments_waiting", table_name="vendor_payments")
    op.drop_index("ix_vendor_payments_company_vendor_created", table_name="vendor_payments")
    op.drop_index("uq_vendor_payments_one_open", table_name="vendor_payments")
    op.drop_table("vendor_payments")

    op.drop_constraint("credit_limit_paise", "vendors", type_="check")
    op.drop_column("vendors", "credit_limit_paise")
    op.drop_constraint("vendor_credit_limit_paise", "company_rules", type_="check")
    op.drop_column("company_rules", "vendor_credit_limit_paise")

    op.drop_constraint("upi_pair", "companies", type_="check")
    op.drop_constraint("upi_id", "companies", type_="check")
    op.drop_column("companies", "upi_name")
    op.drop_column("companies", "upi_id")
