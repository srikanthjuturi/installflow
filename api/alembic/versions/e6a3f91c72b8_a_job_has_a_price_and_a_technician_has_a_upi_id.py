"""A job has a price, and a technician has a UPI id

Nothing in this product priced a job. `tickets` had exactly one money column —
`bonus_paise` — so what a job PAYS was unknown, and with it unknown so was a
technician's net: `earnings.summary` returned `netPaise=None, earnedPaise=None`
and the phone printed a dash under a line apologising for it.

This revision gives those figures a source.

  * `product_models.technician_payout_paise` / `.vendor_price_paise` — the two
    sides of what a job is worth. The margin between them is the company's.
  * `tickets.technician_payout_paise` / `.vendor_price_paise` — the same two,
    STAMPED at intake rather than joined at read time. A model repriced in March
    must not restate what a January ticket was worth.
  * `technician_profiles.upi_id` — where the money goes.
  * `ledger_entries.kind` grows a third value, `payout`.

## NOT NULL, and why that was affordable

Prices are mandatory: a model nobody has priced is one no ticket can be costed
against, and enforcing that in the request layer alone would leave the Excel
importer and the vendor API intake channel free to write a priceless row that
only fails much later, on somebody else's screen.

It was affordable because there was almost nothing to convert. Measured before
writing this, on both databases: `RelianceProdDB` held zero companies, zero
models and zero tickets; `RelianceDB` held **one** model and zero tickets. So
`tickets` takes its two columns NOT NULL directly — there are no rows — and
`product_models` needs the three-step add/backfill/alter for a single row.

That row is the development demo model (24" Inch, DECCANSOFT SOFTWARE SERVICES).
It is backfilled at **₹10 / ₹20**, chosen by the product owner as a placeholder
to keep the demo catalogue usable. It is a placeholder, not a price, and the
first edit on Configuration → Categories replaces it.

## No server_default survives this migration

Deliberate, and the trap worth naming: a `server_default` of 1000 left on
`technician_payout_paise` would silently price every future model at ₹10, and
the console form would look like it was working. The default exists only for the
length of the backfill and is dropped in the same step that sets NOT NULL.

`ledger_entries` gets its CHECK rebuilt rather than a new column. `payout`
arrives WITH its two writers — a customer-confirmed closure in
`feedback_service.record_feedback` and a manager's in `force_close_ticket` — per
hard rule 8. A payout is NOT pool money: `core.ledger.pool` and
`earnings.summary` were already safe (both read their kinds by name), but
`features/ledger._entries_query` summed whatever it found and had to be taught
to exclude it, or job payouts would have appeared in the console's penalty pool.

## Migrate before publishing

Both slices load tickets with whole-entity `select(Ticket)`, so the moment the
model declares these columns every ticket read in the product asks for them. An
API published against an unmigrated database does not degrade — it 500s the
ticket list, the pool, My jobs and the console.

Revision ID: e6a3f91c72b8
Revises: c2f70a5b81e4
Create Date: 2026-09-03 16:42:08.331904

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e6a3f91c72b8"
down_revision: Union[str, Sequence[str], None] = "c2f70a5b81e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

#: The placeholder the one pre-existing development model is backfilled with.
#: ₹10 to the technician, ₹20 from the vendor, in paise.
_SEED_TECHNICIAN_PAYOUT_PAISE = 1000
_SEED_VENDOR_PRICE_PAISE = 2000


def _drop_ledger_kind_check() -> None:
    """Drop the `kind` CHECK on `ledger_entries` by whatever it is called.

    The initial schema created it as `ck_ledger_entries_ck_ledger_entries_kind`
    — the doubled prefix `api/AGENTS.md` warns about, produced by passing an
    already-prefixed name through a naming convention that adds one. Its sibling
    `ck_ledger_entries_ck_ledger_entries_amount_paise` still carries the same
    spelling, so this is not a one-off typo.

    Spelling either name out breaks the other direction: `drop_constraint` runs
    the convention too, so the string that finds the doubled name in `upgrade`
    cannot find the single-prefixed one this migration leaves behind. Resolving
    the real name from `pg_constraint` is exactly what that AGENTS.md rule asks
    for, and it makes both directions run on a database carrying either spelling.

    Matched on the definition rather than the name: `amount_paise`'s CHECK reads
    `((amount_paise > 0))` and never mentions `kind`.
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
             AND pg_get_constraintdef(oid) LIKE '%kind%';
          IF target IS NOT NULL THEN
            EXECUTE format(
              'ALTER TABLE ledger_entries DROP CONSTRAINT %I', target
            );
          END IF;
        END $$;
        """
    )


def upgrade() -> None:
    # ── product_models: add nullable, backfill, then tighten ─────────────────
    #
    # Three steps rather than one because this table has rows. The
    # `server_default` is what fills them; `server_default=None` on the
    # `alter_column` is what removes it again, so a model created tomorrow must
    # supply a real price instead of inheriting ₹10.
    op.add_column(
        "product_models",
        sa.Column(
            "technician_payout_paise",
            sa.Integer(),
            nullable=False,
            server_default=sa.text(str(_SEED_TECHNICIAN_PAYOUT_PAISE)),
        ),
    )
    op.add_column(
        "product_models",
        sa.Column(
            "vendor_price_paise",
            sa.Integer(),
            nullable=False,
            server_default=sa.text(str(_SEED_VENDOR_PRICE_PAISE)),
        ),
    )
    op.alter_column("product_models", "technician_payout_paise", server_default=None)
    op.alter_column("product_models", "vendor_price_paise", server_default=None)

    # `> 0`, not `>= 0`: a free job is not a cheap job, it is a missing price.
    # Named without the `ck_<table>_` prefix — the naming convention on
    # `target_metadata` adds it, and passing it too produced
    # `ck_tickets_ck_tickets_status` once already.
    op.create_check_constraint(
        "technician_payout_paise", "product_models", "technician_payout_paise > 0"
    )
    op.create_check_constraint(
        "vendor_price_paise", "product_models", "vendor_price_paise > 0"
    )

    # ── tickets: no rows in either database, so NOT NULL goes on directly ────
    op.add_column(
        "tickets",
        sa.Column("technician_payout_paise", sa.Integer(), nullable=False),
    )
    op.add_column(
        "tickets", sa.Column("vendor_price_paise", sa.Integer(), nullable=False)
    )
    op.create_check_constraint(
        "technician_payout_paise", "tickets", "technician_payout_paise > 0"
    )
    op.create_check_constraint(
        "vendor_price_paise", "tickets", "vendor_price_paise > 0"
    )

    # ── the technician's payout account ──────────────────────────────────────
    #
    # Nullable and no backfill: null means "not given yet", which is true of
    # every technician today and stays true of anyone a manager onboards without
    # asking. It costs the ability to REDEEM, never the ability to earn.
    op.add_column(
        "technician_profiles", sa.Column("upi_id", sa.String(length=256), nullable=True)
    )
    # A backstop only. The real VPA shape is validated in `schemas.py`, where it
    # can name the field; this rules out what is obviously not an address so an
    # importer bypassing the request layer cannot store a bare name.
    op.create_check_constraint(
        "upi_id",
        "technician_profiles",
        "upi_id IS NULL OR (position('@' in upi_id) > 1 "
        "AND upi_id !~ '\\s' AND length(upi_id) >= 3)",
    )

    # ── the third ledger kind ────────────────────────────────────────────────
    _drop_ledger_kind_check()
    op.create_check_constraint(
        "kind", "ledger_entries", "kind IN ('penalty', 'bonus', 'payout')"
    )


def downgrade() -> None:
    # Payout entries would violate the two-value CHECK going back. Delete them
    # rather than letting the constraint fail with nothing on screen to explain
    # it: they are derivable again from the tickets they credit, and a downgrade
    # that cannot run is not a downgrade.
    op.execute("DELETE FROM ledger_entries WHERE kind = 'payout'")
    _drop_ledger_kind_check()
    op.create_check_constraint(
        "kind", "ledger_entries", "kind IN ('penalty', 'bonus')"
    )

    # Constraint names are passed BARE here. `op.drop_constraint` runs the same
    # naming convention `create_check_constraint` does, so spelling out
    # `ck_tickets_vendor_price_paise` asks Postgres for
    # `ck_tickets_ck_tickets_vendor_price_paise` and fails — the trap this file
    # has now hit twice, and the reason `_drop_ledger_kind_check` exists.
    op.drop_constraint("upi_id", "technician_profiles", type_="check")
    op.drop_column("technician_profiles", "upi_id")

    op.drop_constraint("vendor_price_paise", "tickets", type_="check")
    op.drop_constraint("technician_payout_paise", "tickets", type_="check")
    op.drop_column("tickets", "vendor_price_paise")
    op.drop_column("tickets", "technician_payout_paise")

    op.drop_constraint("vendor_price_paise", "product_models", type_="check")
    op.drop_constraint("technician_payout_paise", "product_models", type_="check")
    op.drop_column("product_models", "vendor_price_paise")
    op.drop_column("product_models", "technician_payout_paise")
