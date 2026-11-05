"""A7 part two: an offline free-text store, and the real platforms seeded.

  * **`tickets.purchase_platform_detail`** — `String(120)`, nullable. The
    OFFLINE half of "where was it bought": a vendor's own words
    ("Croma showroom, Banjara Hills") for a purchase that has no real
    platform to join. The ONLINE half already exists
    (`purchase_platform_id`, `62cb776c943d`) and now also finds-or-creates a
    real `purchase_platforms` row from a vendor's typed "Others" name
    (`core.purchase_platforms.find_or_create`) — that half needed no schema
    change, only a service one.
  * **`ck_tickets_purchase_platform_detail_requires_offline`** — the mirror
    of `purchase_platform_requires_online` beside it: a typed store name
    asserts an OFFLINE purchase, so the two purchase-platform columns can
    never both be set.
  * **The real platform seed** — every company that already exists gets the
    twelve real e-commerce platforms this product now ships with (Amazon,
    Flipkart, Reliance Digital, Croma, Tata CLiQ, Vijay Sales, JioMart,
    Myntra, Meesho, Snapdeal, Ajio, Nykaa), so the ONLINE dropdown is never
    a company's bare own-site-or-nothing on day one. `create_company` seeds
    the same list for a company created from today on
    (`core.purchase_platforms.seed_default_platforms`) — this migration is
    the other half, for every company that predates it.

## The seed is idempotent by construction, not by a flag

`INSERT ... SELECT ... WHERE NOT EXISTS`, keyed on `lower(name)` among a
company's own non-deleted rows — the same uniqueness
`uq_purchase_platforms_company_name_lower` enforces. Re-running this
migration (a failed deploy retried, a `downgrade` immediately followed by
another `upgrade`) inserts nothing a second time: a company that has since
renamed "Amazon" to "Amazon India" gets a fresh "Amazon" row rather than two
competing for the same name, and a company where staff already added their
own "Amazon" keeps that row untouched.

## The seed's own list is SPELLED OUT, not imported

`alembic/versions/*.py` never imports `app.*` (hard rule 6) — a future edit
to `core.purchase_platforms.DEFAULT_PURCHASE_PLATFORMS` must not silently
rewrite what THIS migration already did. The two lists are independent
copies on purpose, the same relationship `e4b9d2a7c1f8`'s `_FREE_CREDITS`
has with `PLATFORM_DEFAULTS`.

## The hand-written piece autogenerate cannot see

`uq_purchase_platforms_company_name_lower` is a functional `lower()` partial
index, created by hand in `62cb776c943d`. `--autogenerate` will keep
offering to drop it on every future revision because `Index()` cannot
express `lower()` with a `WHERE` — delete that drop, the same trap this
file's own predecessor already documents. Nothing here recreates or touches
that index; it is mentioned only because the seed below relies on it to make
a retyped platform name 409 rather than duplicate.

## The downgrade

The CHECK and the column reverse cleanly — refused, like
`62cb776c943d`'s own downgrade, if any ticket still carries a value in it,
because a store name typed by a vendor is not reconstructible once the
column is gone.

The SEEDED platform rows are a different question, and they **stay**.
Deleting them on downgrade would be wrong the moment a ticket this
migration never touches has, in the time since, come to name one of them
(`purchase_platform_id` is RESTRICT) — and even for the ones that have not,
a platform a company's own catalogue may since have grown products or
tickets against is not something a schema downgrade should guess is safe to
remove. A platform nobody wants is retired the ordinary way,
`is_active = false` on the Platforms screen, not erased by rolling back a
migration.

Revision ID: 795fd860adc8
Revises: 62cb776c943d
Create Date: 2026-10-29
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "795fd860adc8"
down_revision: Union[str, Sequence[str], None] = "62cb776c943d"
branch_labels = None
depends_on = None

#: Spelled out, not imported — see the module docstring's second note.
_DEFAULT_PLATFORMS = (
    "Amazon",
    "Flipkart",
    "Reliance Digital",
    "Croma",
    "Tata CLiQ",
    "Vijay Sales",
    "JioMart",
    "Myntra",
    "Meesho",
    "Snapdeal",
    "Ajio",
    "Nykaa",
)


def upgrade() -> None:
    # ── the offline free-text column ────────────────────────────────────────
    op.add_column(
        "tickets",
        sa.Column("purchase_platform_detail", sa.String(length=120), nullable=True),
    )
    # The mirror of `purchase_platform_requires_online` beside it.
    op.create_check_constraint(
        "purchase_platform_detail_requires_offline",
        "tickets",
        "purchase_platform_detail IS NULL OR purchase_mode = 'offline'",
    )

    # ── the real platform seed, for every company that already exists ──────
    #
    # One company-scoped INSERT per platform name rather than a single
    # cross-join, so the WHERE NOT EXISTS reads as the exact rule
    # `uq_purchase_platforms_company_name_lower` enforces, and a single bad
    # name would be one easy line to find rather than a clause inside a
    # bigger statement.
    bind = op.get_bind()
    for name in _DEFAULT_PLATFORMS:
        bind.execute(
            sa.text(
                """
                INSERT INTO purchase_platforms (company_id, name)
                SELECT c.id, CAST(:name AS varchar)
                FROM companies c
                WHERE c.deleted_at IS NULL
                  AND NOT EXISTS (
                        SELECT 1 FROM purchase_platforms p
                        WHERE p.company_id = c.id
                          AND p.deleted_at IS NULL
                          AND lower(p.name) = lower(CAST(:name AS varchar))
                  )
                """
            ),
            {"name": name},
        )


def downgrade() -> None:
    bind = op.get_bind()

    named_detail = bind.scalar(
        sa.text(
            "SELECT count(*) FROM tickets WHERE purchase_platform_detail IS NOT NULL"
        )
    )
    if named_detail:
        raise RuntimeError(
            f"Refusing to downgrade: {named_detail} ticket(s) carry a free-text "
            "purchase platform detail. Dropping the column would lose it — "
            "nothing reconstructs a vendor's own typed words."
        )

    op.drop_constraint(
        "purchase_platform_detail_requires_offline", "tickets", type_="check"
    )
    op.drop_column("tickets", "purchase_platform_detail")

    # The seeded platform rows are deliberately NOT removed — see "The
    # downgrade" in the module docstring. A platform RESTRICTs any ticket
    # that has come to name it, and even an unreferenced one may since carry
    # a company's own edits (renamed, deactivated) this migration has no way
    # to tell apart from one it seeded. Retiring one is `is_active = false`
    # on the Platforms screen, not a side effect of rolling back a schema
    # change.
