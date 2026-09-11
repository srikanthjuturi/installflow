"""A penalty can be reversed

A cancellation or no-show penalty was final: nothing in the product could give
the money back, however good the technician's reason turned out to be. A
manager can now reverse one — in full, with a written reason — and three things
widen so it can be recorded, all in this one revision per hard rule 8:

  * `ledger_entries.kind = 'reversal'`, with `reverses_id` naming the penalty
    it cancels. A NEW row rather than a mark on the penalty, because the table's
    own rule is that nothing in it is ever edited: "a correction is a NEW entry
    rather than a rewrite of an old one". The penalty keeps saying what was
    charged; the reversal says it was given back, by whom and why.
  * `ticket_events.kind = 'penalty_reversed'` — the trail's half of it, so the
    ticket a penalty was charged on also says it was returned.
  * `penalties.reverse` — a new feature, granted by default to the four staff
    roles. Paired with an Area-Manager rank floor in the router, the way every
    decision that spends pool money is (hard rule 2).

## One reversal per penalty, enforced here

`uq_ledger_entries_reverses` is a partial UNIQUE on `(company_id, reverses_id)`,
so a double-click or two managers acting at once cannot return the same money
twice. It is also the covering index the self-referencing FK needs. That FK is
composite — `(company_id, reverses_id) -> (company_id, id)` — so a reversal can
never point at another company's penalty, which is why `(company_id, id)` gains
a UNIQUE of its own here: Postgres needs one as the target.

`reversal_points_back` ties the two together: a reversal always names what it
reverses, and nothing else ever does.

## The downgrade refuses while any reversal exists

Rolling back would have to delete those rows, and a deleted reversal silently
re-charges the technician it was written for — money quietly taken a second
time, with no record that it was ever returned. That is not a trade a migration
should make on its own, so it stops and says how many there are, the shape
`f4b28d1a67c3` uses for a NOT NULL with no honest default.

Revision ID: e8b2f47c19d3
Revises: d1a7c35e9b42
Create Date: 2026-09-11 10:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e8b2f47c19d3"
down_revision: Union[str, Sequence[str], None] = "d1a7c35e9b42"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


#: The event kinds as they stand before this revision. Spelled out rather than
#: imported from the model: a migration must keep describing the database it was
#: written against, even after the model has moved on.
_EVENTS = (
    "'created', 'slot_requested', 'slot_confirmed', 'confirmation_sent', "
    "'status_changed', 'assigned', 'started', 'feedback_requested', "
    "'completed', 'feedback_received', 'reopened', 'serial_mismatch', "
    "'serial_corrected', 'reminded', 'customer_notified', 'escalated', "
    "'bonus_added', 'released', 'no_show', 'force_closed', 'rescheduled'"
)

_LEDGER_KINDS_OLD = "kind IN ('penalty', 'bonus', 'payout')"
_LEDGER_KINDS_NEW = "kind IN ('penalty', 'bonus', 'payout', 'reversal')"

_FEATURE = "penalties.reverse"
#: The four staff roles. Territory does the rest: an Area Manager only ever
#: reaches a ticket inside their own states, so "the ticket's AM, else its RH,
#: else a NH, else an Admin" needs no rule beyond who can see the ticket.
_ROLES = ("admin", "national_head", "regional_head", "area_manager")


def _drop_ledger_kind_check() -> None:
    """Drop the `kind` CHECK on `ledger_entries` by whatever it is called.

    Resolved from `pg_constraint` as `e6a3f91c72b8` does, because older
    databases carried a doubled `ck_ledger_entries_ck_ledger_entries_kind`.

    ⚠ Matched on `'penalty'`, NOT on `kind` as that migration did. This
    revision adds `reversal_points_back`, which mentions `kind` too, and a
    `LIKE '%kind%'` would pick one of the two at random.
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
            EXECUTE format(
              'ALTER TABLE ledger_entries DROP CONSTRAINT %I', target
            );
          END IF;
        END $$;
        """
    )


def upgrade() -> None:
    # ── ledger_entries ────────────────────────────────────────────────────────
    _drop_ledger_kind_check()
    op.create_check_constraint("kind", "ledger_entries", _LEDGER_KINDS_NEW)

    # Nullable, and null is every row but a reversal.
    op.add_column("ledger_entries", sa.Column("reverses_id", sa.Uuid(), nullable=True))
    # The composite FK's target. TOTAL, not partial — a partial index cannot be
    # a foreign key target.
    op.create_unique_constraint(
        "uq_ledger_entries_company_id_id", "ledger_entries", ["company_id", "id"]
    )
    op.create_foreign_key(
        "fk_ledger_entries_company_reverses",
        "ledger_entries",
        "ledger_entries",
        ["company_id", "reverses_id"],
        ["company_id", "id"],
        ondelete="RESTRICT",
    )
    # One reversal per penalty, and the covering index for the FK above.
    op.create_index(
        "uq_ledger_entries_reverses",
        "ledger_entries",
        ["company_id", "reverses_id"],
        unique=True,
        postgresql_where=sa.text("reverses_id IS NOT NULL"),
    )
    op.create_check_constraint(
        "reversal_points_back",
        "ledger_entries",
        "(kind = 'reversal') = (reverses_id IS NOT NULL)",
    )

    # ── ticket_events ─────────────────────────────────────────────────────────
    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint(
        "kind", "ticket_events", f"kind IN ({_EVENTS}, 'penalty_reversed')"
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
            "label": "Reverse Penalties",
            "parent": "jobs.view",
            # Beside `jobs.force_close` (44) and `jobs.reschedule` (45).
            "sort": 46,
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
    reversals = bind.execute(
        sa.text("SELECT count(*) FROM ledger_entries WHERE kind = 'reversal'")
    ).scalar()
    if reversals:
        raise RuntimeError(
            f"{reversals} penalty reversal(s) exist. Downgrading would delete "
            "them and silently re-charge those technicians. Decide what should "
            "happen to that money first."
        )

    # The grants first, then the feature they point at — `company_role_features`
    # too, because the feature row goes and a dangling override would be a
    # foreign key violation (the reasoning in `a1d8e34b90c7`).
    for table in ("company_role_features", "role_feature_defaults"):
        bind.execute(
            sa.text(
                f"DELETE FROM {table} "
                "WHERE feature_id IN (SELECT id FROM features WHERE key = :key)"
            ),
            {"key": _FEATURE},
        )
    bind.execute(sa.text("DELETE FROM features WHERE key = :key"), {"key": _FEATURE})

    # With no reversal rows (checked above) there can be no event recording one
    # that still stands; any left over describe money this rollback keeps.
    op.execute("DELETE FROM ticket_events WHERE kind = 'penalty_reversed'")
    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint("kind", "ticket_events", f"kind IN ({_EVENTS})")

    # The pairing CHECK first, by name — it mentions `kind`, see the helper.
    op.drop_constraint("reversal_points_back", "ledger_entries", type_="check")
    op.drop_index("uq_ledger_entries_reverses", table_name="ledger_entries")
    op.drop_constraint(
        "fk_ledger_entries_company_reverses", "ledger_entries", type_="foreignkey"
    )
    op.drop_constraint(
        "uq_ledger_entries_company_id_id", "ledger_entries", type_="unique"
    )
    op.drop_column("ledger_entries", "reverses_id")
    _drop_ledger_kind_check()
    op.create_check_constraint("kind", "ledger_entries", _LEDGER_KINDS_OLD)
