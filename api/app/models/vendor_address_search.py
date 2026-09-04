"""One row per address search a vendor's portal made against Google.

## Why this table exists at all

Google Places is called STRAIGHT FROM THE BROWSER — `adminWeb/src/lib/googleMaps.ts`
loads the JS SDK and `useAddressAutocomplete.ts` queries it directly. Nothing
passes through this API, so a search leaves no trace here and cannot be counted
after the fact. The portal has to say "that happened", and this is where it lands.

## What one row means

Exactly one billed Google session. The portal holds a single
`AutocompleteSessionToken` across every keystroke up to a selection, and Google
charges the session once rather than per request — so a row per keystroke would
report a number several times the size of the bill, and a row per PICKED address
would miss every lookup somebody abandoned after Google had already answered.
A session is the honest unit, and it is the one the client already tracks.

`search_session_id` is OUR uuid for that session, minted beside Google's token.
Google's token is an opaque object with no stable serialisable id, and storing a
Google identifier would couple this table to a vendor of a different kind.

## Why the count is never a column

`api/AGENTS.md` hard rule 8. `technician_profiles.jobs_completed` was a
`NOT NULL DEFAULT 0` counter nothing measured, so every profile asserted a count
of zero it had never taken. The console's figure is a live `COUNT` over these
rows — see `vendors.service._address_search_counts`, which is the same grouped
query `_ticket_counts` already uses.

## What is deliberately NOT stored

* **The typed query.** A count does not need it, and a half-typed customer
  address is personal data we would then own forever.
* **A ticket id.** Most searches never become a ticket — the column would be
  nullable and mostly null, which is the `jobs_completed` mistake wearing a
  different hat. It can be added the day something reads it.
* **A `source` vocabulary.** There is one writer. `ticket_events` declares only
  the kinds its code writes today, for the same reason.

`created_by` from `AuditMixin` already records WHICH person searched — the
vendor's own login or one of their staff — so a per-person breakdown is a
`GROUP BY` away without a column of its own.

Nothing here is ever edited or deleted, so there is no `SoftDeleteMixin`, and
`updated_at` / `updated_by` arrive from the mixin unused exactly as they do on
`ticket_events` and `ledger_entries`.
"""

import uuid

from sqlalchemy import (
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin


class VendorAddressSearch(Base, IdMixin, AuditMixin):
    __tablename__ = "vendor_address_searches"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: COMPOSITE FK — see __table_args__. Never a plain single-column FK, or a
    #: row in company A could name company B's vendor.
    vendor_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)

    #: The client's id for one autocomplete session. Its UNIQUE is what makes
    #: the write idempotent: a retried request, a double-fired debounce or a
    #: replay after a token refresh all collapse onto the row already there
    #: instead of inflating the count.
    search_session_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)

    __table_args__ = (
        # One index doing three jobs, which is why there is only one: the
        # covering index the composite FK needs (columns IN ORDER — Postgres
        # creates none, and without it removing a vendor scans this whole
        # table), the console's per-vendor grouped COUNT, and a prefix-cover
        # for the `company_id` FK so a second single-column index would be pure
        # write cost.
        #
        # `created_at` is deliberately NOT in it. The console shows a lifetime
        # total and nothing reads a date window; adding a column for a reader
        # that does not exist is the habit hard rule 8 exists to stop. The day
        # a "this month" figure is wanted, it goes on the end of this index.
        Index("ix_vendor_address_searches_company_vendor", "company_id", "vendor_id"),
        # TOTAL, not partial on `deleted_at IS NULL` — that rule is about
        # soft-deleted tables keeping a name hostage, and this table has no
        # `deleted_at` to be partial on.
        #
        # ⚠ Spelled with its `uq_` prefix, which is the OPPOSITE of the rule for
        # CHECKs. The `ck` convention is `ck_%(table_name)s_%(constraint_name)s`,
        # so passing a prefixed name there produces `ck_x_ck_x_y`; the `uq`
        # convention is `uq_%(table_name)s_%(column_0_name)s` and contains no
        # `%(constraint_name)s`, so an explicit name is taken verbatim and a
        # bare one stays bare. Written without the prefix this compiled to
        # `vendor_address_searches_session`, disagreeing with the migration
        # forever — `alembic check` reported a drop-and-recreate on every run,
        # and `on_conflict_do_nothing(constraint=...)` below names it too.
        UniqueConstraint(
            "company_id", "search_session_id", name="uq_vendor_address_searches_session"
        ),
        ForeignKeyConstraint(
            ["company_id", "vendor_id"],
            ["vendors.company_id", "vendors.id"],
            name="fk_vendor_address_searches_company_vendor",
            ondelete="CASCADE",
        ),
    )
