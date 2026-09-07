"""A slot can move

A confirmed slot has been immovable since the schema was written, and the whole
product says so out loud: the console's approved copy reads "Slot confirmed &
locked", the `released` event's docstring says "the customer's time was never
the technician's to move", and the WhatsApp the customer holds ends "To change
the time, please contact us."

That is right about who owns the time and wrong about what happens next, and it
leaves two dead ends this codebase already documents:

  * **the technician at the door.** The customer says "sorry, come Wednesday".
    The only exit is a cancellation, which charges the band, escalates under
    four hours, and hands the job back to a pool that cannot serve it either —
    because the slot being re-offered is the one the customer just refused.
  * **the escalation queue's missed half.** `list_escalations` carries a ⚠
    saying it only ever grows, because "re-slotting means asking the customer
    for another time, which is a conversation and not a status change".
    `record_no_show` says the same. This is what makes it a status change.

Four widenings, all in this one revision per hard rule 8 — a vocabulary
declared ahead of its rows is how `audit_logs` ended up a table nothing ever
wrote to:

  * `ticket_events.kind = 'rescheduled'` — the move itself. `note` carries BOTH
    windows, because "what was it before" is the first question anybody asks,
    and a ticket may carry many: there is deliberately no cap on how often a
    slot moves. It is also the marker six sweeps now re-arm against, so it has
    to exist before any of them can read it.
  * `otp_codes.purpose = 'reschedule'` — the customer's consent, as a code they
    read back to the technician standing in front of them. A fourth purpose on
    the existing table rather than anything new: the pepper, the TTL, the
    five-attempt burn, the resend cooldown and both window counters are all
    destination-agnostic and come free.
  * `otp_codes.ticket_id` — which visit the code authorises. Without it a
    customer with two open tickets has one code that verifies either, and
    `_mint` keeps only ONE live code per destination, so the code minted for
    ticket B is exactly the row a verification of ticket A would find.
  * `otp_codes.slot_start` — which WINDOW they agreed to. The ticket alone is
    not enough: a customer who says "Thursday morning" has consented to
    Thursday morning, and a code bound only to the ticket would move the visit
    to any window the client posted. It is minted for one time and verifies
    for that time.
  * `notifications.kind = 'rescheduled'` — the vendor asked for this visit, and
    was the one party the move never reached. Carries `vendor_id`, so it widens
    to their portal the way `assigned` and `serial_mismatch` already do.
  * `jobs.reschedule` — its own feature, granted to the four staff roles AND to
    technicians. One key rather than two: `company_role_features` overrides are
    per role, so a company that wants its technicians not to reschedule while
    its managers still can flips exactly one row.

## The plain foreign key on `otp_codes.ticket_id` is deliberate

Every parent link inside tenant data is composite on `(company_id, parent_id)`,
and this one cannot be: `otp_codes` has no `company_id` at all, because a code
is issued before a company is selected — auth precedes tenancy, which is why
`audit_tenancy` already exempts the table.

What keeps it safe is not the constraint. Both reschedule endpoints load the
ticket through a company-scoped loader FIRST (`mine_query` for the technician,
`_load` for the console) and only then require the code's `ticket_id` to equal
that ticket's id, so a code minted against another tenant's ticket can never be
presented for one of ours. `audit_tenancy`'s exemption note now says this, and
the table is deliberately absent from `TENANT_LINKS` — that check would demand a
two-column key that cannot exist here, and would fail for ever.

## `ix_notifications_company_ticket`

Not cosmetic and not really new work. The sweep re-arms ask "when was a
`no_show` / `force_close` bell last raised for THIS ticket", correlated on
`(company_id, ticket_id, kind)`, and `notifications` has no index starting with
those columns — only `(company_id, created_at)` and `(company_id, vendor_id)`.
It is also the covering index the `notifications → tickets` composite FK has
been owed since `494d63571f2f`, so hard rule 8 wanted it anyway.

## Nothing is backfilled, and the downgrade cannot put a slot back

No existing ticket is rescheduled by this migration, and none could be: which
slot a customer would have agreed to is not a question a migration can answer.

Going the other way, a slot that has already moved STAYS moved. The window it
held before survives only in the `rescheduled` event's `note`, and the downgrade
deletes those rows because the restored CHECK cannot hold them. That is the
trade-off every widening in this directory has made, and it is worth stating
plainly here because this is the first one where the deleted row is the only
record of a change to a column that keeps no history of its own.

Revision ID: d6a1f38b04e5
Revises: c4e81b90f7a2
Create Date: 2026-09-06 11:42:07.331290

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d6a1f38b04e5"
down_revision: Union[str, Sequence[str], None] = "c4e81b90f7a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


#: The kinds as they stand before this revision. Spelled out rather than
#: imported from the model: a migration must keep describing the database it was
#: written against, even after the model has moved on.
_EVENTS = (
    "'created', 'slot_requested', 'slot_confirmed', 'confirmation_sent', "
    "'status_changed', 'assigned', 'started', 'feedback_requested', "
    "'completed', 'feedback_received', 'reopened', 'serial_mismatch', "
    "'serial_corrected', 'reminded', 'customer_notified', 'escalated', "
    "'bonus_added', 'released', 'no_show', 'force_closed'"
)

_PURPOSE_OLD = "purpose IN ('login','invite','password_reset')"
_PURPOSE_NEW = "purpose IN ('login','invite','password_reset','reschedule')"

#: The notification kinds as they stand before this revision.
_NOTIFICATIONS = (
    "'escalation', 'ai', 'serial_mismatch', 'force_close', 'slot', "
    "'technician_joined', 'job_started', 'invite_expired', 'assigned', "
    "'no_show', 'product_submitted', 'product_approved', 'product_rejected'"
)

_FEATURE = "jobs.reschedule"
#: The four staff roles that already hold `jobs.force_close`, plus the
#: technician — the two doors onto one act, and the reason it is one key.
_ROLES = (
    "admin",
    "national_head",
    "regional_head",
    "area_manager",
    "technician",
)


def upgrade() -> None:
    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint(
        "kind", "ticket_events", f"kind IN ({_EVENTS}, 'rescheduled')"
    )

    op.drop_constraint("purpose", "otp_codes", type_="check")
    op.create_check_constraint("purpose", "otp_codes", _PURPOSE_NEW)

    # Nullable, and null is the normal case: three of the four purposes have no
    # ticket. Mirrors `invite_id` exactly, including the CASCADE — a spent or
    # expiring one-time code has nothing left to say about a deleted ticket.
    op.add_column("otp_codes", sa.Column("ticket_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_otp_codes_ticket_id_tickets",
        "otp_codes",
        "tickets",
        ["ticket_id"],
        ["id"],
        ondelete="CASCADE",
    )
    # Postgres creates no index for a foreign key, and without one every DELETE
    # of a ticket scans a table that only ever grows.
    op.create_index("ix_otp_codes_ticket_id", "otp_codes", ["ticket_id"])
    # Which window the code was minted for. No index: it is never searched on,
    # only compared against the row `ticket_id` already found.
    op.add_column(
        "otp_codes",
        sa.Column("slot_start", sa.DateTime(timezone=True), nullable=True),
    )

    op.drop_constraint("kind", "notifications", type_="check")
    op.create_check_constraint(
        "kind", "notifications", f"kind IN ({_NOTIFICATIONS}, 'rescheduled')"
    )

    op.create_index(
        "ix_notifications_company_ticket",
        "notifications",
        ["company_id", "ticket_id", "kind"],
    )

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
            "label": "Reschedule Job",
            "parent": "jobs.view",
            # 44 is `jobs.force_close`. Both slots the reader will look for.
            "sort": 45,
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
    # The grants first, then the feature they point at — `a1d8e34b90c7`'s order
    # and its reasoning: the feature row goes, so a per-company override left
    # behind would be a foreign key violation.
    bind.execute(
        sa.text(
            """
            DELETE FROM company_role_features
            WHERE feature_id IN (SELECT id FROM features WHERE key = :key)
            """
        ),
        {"key": _FEATURE},
    )
    bind.execute(
        sa.text(
            """
            DELETE FROM role_feature_defaults
            WHERE feature_id IN (SELECT id FROM features WHERE key = :key)
            """
        ),
        {"key": _FEATURE},
    )
    bind.execute(sa.text("DELETE FROM features WHERE key = :key"), {"key": _FEATURE})

    # The bells go before the CHECK that would refuse them — same trade-off as
    # the events below, and cheaper: a notification is a work item somebody has
    # already seen, not a record anything else depends on.
    op.execute(
        "DELETE FROM notification_reads WHERE notification_id IN "
        "(SELECT id FROM notifications WHERE kind = 'rescheduled')"
    )
    op.execute("DELETE FROM notifications WHERE kind = 'rescheduled'")
    op.drop_constraint("kind", "notifications", type_="check")
    op.create_check_constraint(
        "kind", "notifications", f"kind IN ({_NOTIFICATIONS})"
    )

    op.drop_index("ix_notifications_company_ticket", table_name="notifications")

    op.drop_column("otp_codes", "slot_start")
    op.drop_index("ix_otp_codes_ticket_id", table_name="otp_codes")
    op.drop_constraint("fk_otp_codes_ticket_id_tickets", "otp_codes", type_="foreignkey")
    op.drop_column("otp_codes", "ticket_id")

    # These are spent or expiring one-time codes, never anything a person could
    # need again — the same judgement `f3a1c8b25d47` made about the email ones.
    op.execute("DELETE FROM otp_codes WHERE purpose = 'reschedule'")
    op.drop_constraint("purpose", "otp_codes", type_="check")
    op.create_check_constraint("purpose", "otp_codes", _PURPOSE_OLD)

    # ⚠ The tickets themselves keep their moved slots. Only the record of the
    # move goes, because the restored CHECK cannot hold these rows — so after a
    # rollback a slot that was rescheduled reads as though the customer had
    # picked it in the first place. See the module docstring.
    op.execute("DELETE FROM ticket_events WHERE kind = 'rescheduled'")
    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint("kind", "ticket_events", f"kind IN ({_EVENTS})")
