"""Address search per vendor, and a log of it

The vendor portal's ticket form offers a Google-backed "Search address" box.
Every session it runs is billed, and until now every vendor had it whether or
not they should, with nothing recording who used it or how much.

Two changes, one switch and one log.

## `vendors.address_search_enabled` defaults TRUE, and that is not the obvious call

A metered third-party capability usually defaults off — nobody spends credits
until somebody opts in. It defaults ON here because switching it off costs more
than money.

A ticket gets `latitude`/`longitude` ONLY from a picked search result
(`AddressFields` nulls them the instant any box is hand-edited), and
`jobs.service._check_live_was_taken_at_the_job` branches on exactly that: with
coordinates it verifies a technician's live photo by DISTANCE against
`company_rules.geo_radius_m`; without them it falls back to comparing the
device's pincode with the ticket's. A pincode can span kilometres. So an off
vendor does not merely lose a convenience — every job they raise is verified
more weakly, and `c2f70a5b81e4` added the coordinates precisely to stop that.

Defaulting on keeps that check intact everywhere and makes the switch a
deliberate opt-out rather than a silent downgrade nobody chose.

There is **no separate backfill**: `ADD COLUMN ... NOT NULL DEFAULT true` fills
every existing row in the same statement, so existing vendors keep the box they
have today and new ones inherit the same answer from one declaration.

The column is named for the capability, not the provider — swapping Places for
another geocoder later must not be a migration.

⚠ It is a UI capability, NOT a spend control. `VITE_GOOGLE_MAPS_API_KEY` is
inlined into the client bundle by design (referrer-restricted in Google Cloud),
so anyone with devtools can drive the SDK regardless of this flag. Capping spend
is a per-key quota and a budget alert in Google Cloud; nothing in this database
can do it.

## `vendor_address_searches` — one row per billed session

Google is called straight from the browser, so this API never sees a search and
cannot count one after the fact. The portal reports each session and this is
where it lands. One row = one `AutocompleteSessionToken` = one Google bill; the
UNIQUE on `(company_id, search_session_id)` is what makes the write idempotent,
so a retry or a double-fired debounce cannot inflate the number.

The count is never a stored column — hard rule 8, and the
`technician_profiles.jobs_completed` postmortem behind it. The console reads a
live `COUNT` over these rows.

## Downgrade destroys the counts

`downgrade()` drops the table, and every recorded search with it. There is
nowhere to preserve them — they are not derivable from anything else, which is
the whole reason the table exists. Going back is a decision to lose the history.

Revision ID: c1a7f30d92b8
Revises: f4b28d1a67c3
Create Date: 2026-09-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c1a7f30d92b8"
down_revision: Union[str, Sequence[str], None] = "f4b28d1a67c3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "vendors",
        sa.Column(
            "address_search_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )

    op.create_table(
        "vendor_address_searches",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("vendor_id", sa.Uuid(), nullable=False),
        sa.Column("search_session_id", sa.Uuid(), nullable=False),
        # Audit columns last, as everywhere — the mixins are `declared_attr` and
        # sort behind the model's own columns.
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
        sa.ForeignKeyConstraint(
            ["company_id"],
            ["companies.id"],
            name=op.f("fk_vendor_address_searches_company_id_companies"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "vendor_id"],
            ["vendors.company_id", "vendors.id"],
            name=op.f("fk_vendor_address_searches_company_vendor"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_vendor_address_searches")),
        sa.UniqueConstraint(
            "company_id",
            "search_session_id",
            name=op.f("uq_vendor_address_searches_session"),
        ),
    )
    # Covering index for the composite FK, the console's grouped COUNT, and a
    # prefix-cover for the company FK — one index, three jobs. See the model.
    op.create_index(
        "ix_vendor_address_searches_company_vendor",
        "vendor_address_searches",
        ["company_id", "vendor_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_vendor_address_searches_company_vendor",
        table_name="vendor_address_searches",
    )
    op.drop_table("vendor_address_searches")
    op.drop_column("vendors", "address_search_enabled")
