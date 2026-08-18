"""product model vendor brand

Revision ID: f4d2c9a15b67
Revises: c1e8b4a7d930
Create Date: 2026-08-18

Every product model carries exactly one vendor — its brand — and the column is
NOT NULL. "43-inch LED" without a maker names nothing a technician can be sent
to install.

⚠ THIS MIGRATION DELETES EVERY PRODUCT MODEL.

No existing model has a brand and none can be inferred from a model name, so
there is no honest backfill: the choice was between inventing an "Unbranded"
placeholder vendor that would outlive its excuse, and clearing rows that are
still seed data. We cleared them, on an explicit decision, while jobs and
tickets — the things that would reference a model forever — do not yet exist.

MODELS ONLY. Categories and subcategories stay, and not merely out of caution:
`technician_subcategories` holds a RESTRICT foreign key to
`product_subcategories` precisely so that removing a subcategory somebody is
certified for is refused rather than silently decertifying them. Deleting the
parents here would either trip that constraint or defeat its whole purpose.

After upgrading, run:

    python -m app.scripts.seed_catalogue

which seeds vendors first, then fills in the missing models — matching the
surviving categories and subcategories by name — and gives each one a brand.

The FK is COMPOSITE on `(company_id, vendor_id)`, pointing at the
`uq_vendors_company_id_id` UNIQUE added in the previous revision — a plain
`vendor_id` FK would let a model in company A be branded with company B's
vendor, and the database would store it happily.

`ondelete="RESTRICT"`, not CASCADE: removing a vendor that still brands models
must be refused with a message the user can act on, never quietly take the
models down with it. The service raises a 409 naming the count before the
database ever gets the chance.

DOWNGRADE IS LOSSY, twice over: it drops the column and every brand with it, and
it does NOT restore the models this migration deleted. Re-seed after downgrading
too.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f4d2c9a15b67'
down_revision: Union[str, Sequence[str], None] = 'c1e8b4a7d930'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("product_models", sa.Column("vendor_id", sa.Uuid(), nullable=True))

    # Nothing references product_models, so this is a plain hard delete. The
    # parents are deliberately left alone — see the module docstring.
    op.execute("DELETE FROM product_models")

    op.alter_column("product_models", "vendor_id", nullable=False)

    op.create_foreign_key(
        "fk_product_models_company_vendor",
        "product_models",
        "vendors",
        ["company_id", "vendor_id"],
        ["company_id", "id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_product_models_vendor_id", "product_models", ["vendor_id"])


def downgrade() -> None:
    """Downgrade schema.

    Lossy: the brands go with the column, and the models deleted on the way up
    are not restored. Re-run seed_catalogue.
    """
    op.drop_index("ix_product_models_vendor_id", table_name="product_models")
    op.drop_constraint(
        "fk_product_models_company_vendor", "product_models", type_="foreignkey"
    )
    op.drop_column("product_models", "vendor_id")
