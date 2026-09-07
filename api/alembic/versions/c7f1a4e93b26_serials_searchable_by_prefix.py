"""Serials searchable by prefix

The intake form looks a serial up while somebody is typing it, and it needs two
things the existing index cannot give:

  * **a prefix scan.** `uq_product_model_serials_model_serial_lower` is
    `(company_id, product_model_id, lower(serial))`, so a search that fixes the
    company and the serial but NOT the model has an unconstrained column in the
    middle of the key. Postgres cannot range-scan through that; it reads every
    serial the company owns.
  * **the exact lookup, too.** Same reason. `lookup_serial` has always matched
    on `(company_id, lower(serial))`, which that index has never actually
    served — it worked because the demo data is small.

So this adds the index those two queries were really asking for. It is not
unique: uniqueness is per (company, MODEL) and stays that way, because two
products sharing a numbering scheme is legal.

Hand-written, like every other `LOWER()` index here — Alembic does not
recognise them and autogenerate emits a drop for it on every run.

Revision ID: c7f1a4e93b26
Revises: b5e9c412d80a
Create Date: 2026-09-07

"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "c7f1a4e93b26"
down_revision: Union[str, Sequence[str], None] = "b5e9c412d80a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # `text_pattern_ops` so a LIKE 'abc%' prefix scan can use it. The default
    # opclass serves equality but NOT prefix matching unless the database
    # happens to be in the C collation, which ours is not.
    op.execute(
        "CREATE INDEX ix_product_model_serials_company_serial_lower "
        "ON product_model_serials (company_id, lower(serial) text_pattern_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_product_model_serials_company_serial_lower")
