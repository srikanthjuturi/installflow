"""vendors.pan and vendors.gst_company_status

Two statutory facts the vendor form now asks for, and which the GSTIN lookup
will fill for the operator once it exists. `companies` has recorded both since
the initial schema; this brings vendors level with it.

Both are NULLABLE, unlike their `companies` counterparts, but for opposite
reasons — and the difference matters when reading a row:

* **pan** is knowable for every vendor already stored, because characters 3-12
  of a GSTIN ARE the holder's PAN. So it is backfilled, not left empty: the
  value is a slice of a column we already hold, not a guess. It stays nullable
  only because a NOT NULL would then have to be defended on every future write
  path (the Excel importer, the vendor API channel) for no gain. A NULL means
  "not filled in yet" — never "this vendor has no PAN".
* **gst_company_status** cannot be known by anybody today. It is answered by the
  GST portal, and nothing here calls it. There is no backfill, and NULL is the
  honest reading: never looked up. Defaulting it to "Active" would assert that a
  registration is live on no evidence at all.

The two columns land physically after the audit columns, because Postgres has no
ALTER TABLE … REORDER and an incremental migration can only append. The model
declares them in their proper place; only `\\d vendors` disagrees.

Revision ID: d3f27a8c1904
Revises: a7c4e1b93d05
Create Date: 2026-08-31

"""

from alembic import op
import sqlalchemy as sa

revision = "d3f27a8c1904"
down_revision = "a7c4e1b93d05"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("vendors", sa.Column("pan", sa.String(length=10), nullable=True))
    op.add_column(
        "vendors", sa.Column("gst_company_status", sa.String(length=64), nullable=True)
    )

    # A GSTIN is <2-digit state code><10-char PAN><entity><Z><checksum>, so the
    # PAN is `substring(gst_number from 3 for 10)` — the same slice the console
    # will use to fill the box. Guarded by the PAN shape rather than taken on
    # faith: a row whose GSTIN somehow does not carry one is left NULL instead of
    # being given ten characters that are not a PAN.
    #
    # Soft-deleted vendors are included. They are restorable, and a row skipped
    # here would be the one row nothing ever fills in again.
    op.execute(
        """
        UPDATE vendors
           SET pan = upper(substring(gst_number from 3 for 10))
         WHERE pan IS NULL
           AND upper(substring(gst_number from 3 for 10)) ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'
        """
    )


def downgrade() -> None:
    op.drop_column("vendors", "gst_company_status")
    op.drop_column("vendors", "pan")
