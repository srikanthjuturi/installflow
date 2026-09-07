"""A vendor can add to the catalogue, and a National Head prices it

Until now only staff holding `masters.edit` — seeded to admin and national_head
— could put anything in the product master. A vendor held `masters.view`, enough
to draw the intake form's product picker and nothing more, so every new model a
vendor started selling had to be relayed out of band and typed in by ops. The
catalogue lagged the vendor's real range, and a vendor could not raise a ticket
for a product nobody had entered yet.

A vendor may now submit their own products. They cannot price them: what a
technician earns is withheld from a vendor everywhere else in this codebase, and
what a vendor is CHARGED is a term between them and the company rather than
something they set for themselves. So a submitted product waits, unpriced, until
a National Head or an Admin types both figures and approves it — or refuses it
with a reason the vendor reads.

## The two price columns become NULLABLE, and what that trades

`technician_payout_paise` and `vendor_price_paise` were NOT NULL with `> 0`
CHECKs, and `create_ticket` carried a comment saying intake therefore needed no
"is it priced?" check. Both are now nullable, because a product waiting for
approval genuinely has neither figure and NULL means "nobody has priced this",
which is a different claim from 0 (hard rule 8).

That is a trade rather than a loss. The guarantee "no row can be unpriced"
becomes "no APPROVED row can be", spelled as the `approved_is_priced` CHECK, and
`tickets._resolve_product` refuses anything that is not approved. Approved
implies priced, and only an approved model reaches intake — so the Excel
importer and the vendor API channel still cannot write a priceless row that
quietly ships, which is the property the NOT NULLs were defending.

## `approval_status` keeps its server default for ever

`e6a3f91c72b8` dropped the price columns' server defaults after backfilling,
because a leftover default would have silently PRICED every future row. This
column keeps `'pending'` permanently, and the difference is the direction of the
failure. A default of `'approved'` would silently make every future row
TICKETABLE; no default at all would turn a forgetful future writer into a NOT
NULL 500. `'pending'` fails closed — a writer that forgets produces a row that is
invisible to intake and visible in the approvals queue, which is somebody
noticing rather than somebody being billed.

## Why the statements are in this order

The only thing that can produce a NULL price is an INSERT or an UPDATE, and
neither happens after the backfill. So: the backfill makes every row `approved`;
`approved_is_priced` is then created against rows that are all still NOT NULL on
both prices, and is satisfied by construction; only then do the columns become
nullable, with the constraint already standing. There is no instant at which the
database would accept an approved row with no price. Creating the constraint
after the ALTER would also pass today, but only by luck — this order is safe by
argument.

## The backfill is unconditional, soft-deleted rows included

Every product that existed before approvals existed was never refused by
anybody, so it is `approved`. That includes rows with `deleted_at` set: one
restored later must not come back pending, waiting on a decision about a product
somebody already removed.

`submitted_at`, `decided_at` and `decided_by` stay NULL on all of them. Nobody
submitted these and nobody decided them, and writing an instant here would fake
an audit trail — the same refusal `f4b28d1a67c3` makes about inventing a company
phone number.

## Downgrade refuses rather than lies

Going back restores NOT NULL on two price columns and removes the only record of
which products were agreed. Both are the same question, because
`approved_is_priced` means an approved row is a priced one — so one guard
answers it, and it names the count somebody has to act on.

The round trip is honest about DDL and lossy about meaning, which is exactly the
trap hard rule 6 warns about: downgrading drops `approval_status`, and
re-upgrading sets every row to `'approved'` again. That is why the guard tests
the status column rather than only the prices — it makes the lossy case
impossible instead of merely documented.

## One rider, and why it is here rather than in its own revision

`_fix_ledger_amount_check` renames a CHECK on an unrelated table. It belongs to
the ledger slice and would normally get its own revision; it rides here because
it is what keeps `alembic check` readable, and reading that output is how this
change was verified. Its own docstring carries the argument.

Revision ID: c4e81b90f7a2
Revises: e1c73b04a95d
Create Date: 2026-09-06

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4e81b90f7a2"
down_revision: Union[str, Sequence[str], None] = "e1c73b04a95d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _in_list(values: Sequence[str]) -> str:
    return ", ".join(f"'{v}'" for v in values)


def _fix_ledger_amount_check() -> None:
    """Rename `ledger_entries`' amount CHECK to what the model actually declares.

    A rider on this migration, and it needs a reason. The initial schema created
    two CHECKs on that table by passing already-prefixed names through a naming
    convention that adds one, producing `ck_ledger_entries_ck_ledger_entries_*`
    — the doubled-prefix trap `api/AGENTS.md` hard rule 6 warns about.
    `e6a3f91c72b8` fixed the `kind` twin and said out loud that this one still
    carried the same spelling.

    It rides here because it is what keeps `alembic check` USABLE. That command
    is how this repo proves a model and a migration agree, and a permanent
    phantom rename in its output is how a real drift gets scrolled past. This
    feature's verification depends on reading that output, so the noise had to
    go with it.

    Matched on the DEFINITION, not the name, for the reason the sibling helper
    gives: `op.drop_constraint` runs the convention too, so a literal name that
    finds the doubled spelling cannot find the single one, and vice versa. This
    runs correctly on a database carrying either.

    One-directional on purpose — `downgrade` does not put the doubled name back.
    Restoring a typo is not reversibility, it is re-introducing a bug, and the
    `kind` fix set that precedent. Re-running is harmless: the DO block finds the
    constraint by its definition whatever it is called.
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
             AND pg_get_constraintdef(oid) LIKE '%amount_paise%'
             AND conname <> 'ck_ledger_entries_amount_paise';
          IF target IS NOT NULL THEN
            EXECUTE format(
              'ALTER TABLE ledger_entries DROP CONSTRAINT %I', target
            );
            ALTER TABLE ledger_entries
              ADD CONSTRAINT ck_ledger_entries_amount_paise
              CHECK (amount_paise > 0);
          END IF;
        END $$;
        """
    )


#: The three approval states, FROZEN.
#:
#: Spelled out rather than imported from `core.product_tree`, and the same for
#: the two notification lists below. A migration is a statement about a moment:
#: importing the live tuple would mean this revision quietly starts writing a
#: different CHECK the day somebody adds a fourth state, so re-running it on an
#: old database would produce a schema that database never had. `f2b6a95d10c7`
#: froze its own kind list for exactly this reason.
#:
#: The models are still the source of truth for the CODE; these are a snapshot
#: of what they said here. A `test_` guard is not worth it — a drift shows up as
#: an `alembic check` diff on the next schema change, which is the same net that
#: catches every other constraint.
APPROVAL_STATES = ("pending", "approved", "rejected")

#: The ten kinds `notifications` allowed before this revision.
KINDS_BEFORE = (
    "escalation", "ai", "serial_mismatch", "force_close", "slot",
    "technician_joined", "job_started", "invite_expired", "assigned", "no_show",
)

#: The three this revision adds. `KINDS_BEFORE + NEW_KINDS` is what the CHECK
#: becomes; `KINDS_BEFORE` alone is what the downgrade restores.
NEW_KINDS = ("product_submitted", "product_approved", "product_rejected")

#: (key, label, parent_key, sort_order) — parent first, self-referencing FK.
#:
#: `masters.approve` ties with `territory.view` on 87. Deliberate and harmless:
#: both `core/features.py` and `rbac/service.py` order by `(sort_order, key)`,
#: so the tie resolves on the key and lands this immediately after
#: `masters.edit` (86) and before `territory.view` — which is where it belongs.
#: Renumbering four existing rows to avoid a tie the ORDER BY already breaks
#: would be more migration surface for no visible difference.
FEATURES = [
    ("masters.approve", "Approve Products", "masters.view", 87),
    ("vendor.catalogue", "Submit Products", "vendor.portal", 97),
]

#: Neither key is `masters.edit`, and hard rule 2 is why: "a key that already
#: exists is not automatically the right key."
#:
#: `masters.approve` is `jobs.force_close`'s shape — a decision that spends
#: money, since the payout typed here prices every ticket ever raised against
#: that product. Its own key lets a company grant catalogue editing without
#: granting the chequebook, and the router pairs it with a National-Head rank
#: floor that no per-company override can lift.
#:
#: `vendor.catalogue` exists because `masters.edit` also gates PUT and DELETE on
#: every node and every model in the tenant. A vendor holding it could rename,
#: delete or pause a COMPETITOR's products — not a theoretical objection, since
#: "let the vendor add products" is exactly the intent under which somebody
#: ticks `masters.edit` on Feature Access.
#:
#: Granted to `vendor` and not `vendor_user`, the line `vendor.users` already
#: draws: a sub-user raises tickets, it does not shape the book. One Feature
#: Access row widens it per company, with no deploy.
DEFAULTS = {
    "admin": ["masters.approve"],
    "national_head": ["masters.approve"],
    "vendor": ["vendor.catalogue"],
}


def upgrade() -> None:
    # 1. The columns. `approval_status` fills every existing row with the SAFE
    #    value; the unsafe one is written on purpose, one statement below.
    op.add_column(
        "product_models",
        sa.Column(
            "approval_status",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
    )
    op.add_column(
        "product_models",
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "product_models",
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "product_models", sa.Column("decided_by", sa.Uuid(), nullable=True)
    )
    op.add_column(
        "product_models",
        sa.Column("rejection_reason", sa.String(length=255), nullable=True),
    )

    # 2. THE BACKFILL. No WHERE: a soft-deleted product was never refused
    #    either, and one restored later must not come back pending. The three
    #    timestamp/actor columns stay NULL — see the docstring.
    op.execute("UPDATE product_models SET approval_status = 'approved'")

    # 3. The new CHECKs, BEFORE the prices are relaxed. Every row is now
    #    'approved' and still NOT NULL on both prices, so `approved_is_priced`
    #    holds by construction and there is never a window in which an unpriced
    #    approved row could be written. Bare names — the naming convention
    #    interpolates the `ck_product_models_` prefix (hard rule 6).
    op.create_check_constraint(
        "approval_status",
        "product_models",
        f"approval_status IN ({_in_list(APPROVAL_STATES)})",
    )
    op.create_check_constraint(
        "approved_is_priced",
        "product_models",
        "approval_status <> 'approved' OR (technician_payout_paise IS NOT NULL "
        "AND vendor_price_paise IS NOT NULL)",
    )
    op.create_check_constraint(
        "both_prices_or_neither",
        "product_models",
        "(technician_payout_paise IS NULL) = (vendor_price_paise IS NULL)",
    )
    op.create_check_constraint(
        "pending_has_no_decision",
        "product_models",
        "approval_status <> 'pending' "
        "OR (decided_at IS NULL AND decided_by IS NULL)",
    )
    op.create_check_constraint(
        "decided_by_with_decided_at",
        "product_models",
        "(decided_at IS NULL) = (decided_by IS NULL)",
    )
    op.create_check_constraint(
        "rejection_reason_only_on_rejected",
        "product_models",
        "(approval_status = 'rejected') = (rejection_reason IS NOT NULL)",
    )
    op.create_check_constraint(
        "pending_was_submitted",
        "product_models",
        "approval_status <> 'pending' OR submitted_at IS NOT NULL",
    )

    # 4. Only now do the prices become nullable, and their CHECKs are rewritten
    #    to say so. A bare `> 0` would already permit NULL — a CHECK counts NULL
    #    as satisfied — but the explicit form is what a reader can trust without
    #    recalling three-valued logic.
    op.alter_column(
        "product_models",
        "technician_payout_paise",
        existing_type=sa.Integer(),
        nullable=True,
    )
    op.alter_column(
        "product_models",
        "vendor_price_paise",
        existing_type=sa.Integer(),
        nullable=True,
    )
    op.drop_constraint("technician_payout_paise", "product_models", type_="check")
    op.drop_constraint("vendor_price_paise", "product_models", type_="check")
    op.create_check_constraint(
        "technician_payout_paise",
        "product_models",
        "technician_payout_paise IS NULL OR technician_payout_paise > 0",
    )
    op.create_check_constraint(
        "vendor_price_paise",
        "product_models",
        "vendor_price_paise IS NULL OR vendor_price_paise > 0",
    )

    # 5. Three notification kinds, built from the model's own tuple so the
    #    constraint cannot drift from the code that writes it.
    op.drop_constraint("kind", "notifications", type_="check")
    op.create_check_constraint(
        "kind",
        "notifications",
        f"kind IN ({_in_list(KINDS_BEFORE + NEW_KINDS)})",
    )

    # 6. An unrelated leftover, fixed here so `alembic check` stays readable.
    _fix_ledger_amount_check()

    # 7. The two feature keys and their role defaults.
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "INSERT INTO features (key, label, parent_key, sort_order, is_active) "
            "VALUES (:k, :l, :p, :s, true)"
        ),
        [{"k": k, "l": lbl, "p": p, "s": s} for k, lbl, p, s in FEATURES],
    )
    conn.execute(
        sa.text(
            "INSERT INTO role_feature_defaults (role, feature_id, enabled) "
            "SELECT :role, f.id, true FROM features f WHERE f.key = :key"
        ),
        [
            {"role": role, "key": key}
            for role, keys in DEFAULTS.items()
            for key in keys
        ],
    )


def downgrade() -> None:
    conn = op.get_bind()

    # Refuse rather than lie. Restoring NOT NULL on the two price columns means
    # every row must be priced; dropping `approval_status` means every row is
    # implicitly approved again. Both are the same question, because
    # `approved_is_priced` guarantees an approved row is a priced one — so one
    # count answers it, and naming it is what lets somebody act.
    #
    # The alternative is to invent a price or delete a vendor's submission.
    # `f4b28d1a67c3` refused the same trade over a company phone number, for the
    # same reason: a migration must not manufacture a fact to make a schema fit.
    undecided = conn.execute(
        sa.text(
            "SELECT count(*) FROM product_models WHERE approval_status <> 'approved'"
        )
    ).scalar()
    if undecided:
        # ASCII only, like `f4b28d1a67c3`'s refusal: this is read in a terminal,
        # and a Windows console in cp1252 turns an em-dash into a question mark
        # at exactly the moment somebody is trying to understand a failure.
        raise RuntimeError(
            f"{undecided} product model(s) are pending or rejected. Going back "
            "would restore NOT NULL on two price columns they cannot satisfy, "
            "and would silently re-approve them on the next upgrade. Price them "
            "or delete them first. This migration will not invent a price to "
            "make a schema fit:\n"
            "  SELECT id, name, approval_status FROM product_models\n"
            "   WHERE approval_status <> 'approved';"
        )

    stale_bells = conn.execute(
        sa.text("SELECT count(*) FROM notifications WHERE kind = ANY(:kinds)"),
        {"kinds": list(NEW_KINDS)},
    ).scalar()
    if stale_bells:
        raise RuntimeError(
            f"{stale_bells} notification(s) use a product-approval kind that "
            "this revision introduced. Narrowing the CHECK would leave rows the "
            "constraint forbids. Delete them first if you mean to go back."
        )

    op.drop_constraint("kind", "notifications", type_="check")
    op.create_check_constraint(
        "kind", "notifications", f"kind IN ({_in_list(KINDS_BEFORE)})"
    )

    op.drop_constraint("technician_payout_paise", "product_models", type_="check")
    op.drop_constraint("vendor_price_paise", "product_models", type_="check")
    op.alter_column(
        "product_models",
        "technician_payout_paise",
        existing_type=sa.Integer(),
        nullable=False,
    )
    op.alter_column(
        "product_models",
        "vendor_price_paise",
        existing_type=sa.Integer(),
        nullable=False,
    )
    op.create_check_constraint(
        "technician_payout_paise", "product_models", "technician_payout_paise > 0"
    )
    op.create_check_constraint(
        "vendor_price_paise", "product_models", "vendor_price_paise > 0"
    )

    for name in (
        "pending_was_submitted",
        "rejection_reason_only_on_rejected",
        "decided_by_with_decided_at",
        "pending_has_no_decision",
        "both_prices_or_neither",
        "approved_is_priced",
        "approval_status",
    ):
        op.drop_constraint(name, "product_models", type_="check")

    for column in (
        "rejection_reason",
        "decided_by",
        "decided_at",
        "submitted_at",
        "approval_status",
    ):
        op.drop_column("product_models", column)

    conn.execute(
        sa.text(
            "DELETE FROM role_feature_defaults WHERE feature_id IN "
            "(SELECT id FROM features WHERE key = ANY(:keys))"
        ),
        {"keys": [k for k, _, _, _ in FEATURES]},
    )
    conn.execute(
        sa.text(
            "DELETE FROM company_role_features WHERE feature_id IN "
            "(SELECT id FROM features WHERE key = ANY(:keys))"
        ),
        {"keys": [k for k, _, _, _ in FEATURES]},
    )
    conn.execute(
        sa.text("DELETE FROM features WHERE key = ANY(:keys)"),
        {"keys": [k for k, _, _, _ in FEATURES]},
    )
