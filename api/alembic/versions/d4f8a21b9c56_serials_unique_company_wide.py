"""Serials unique company-wide

Serial uniqueness tightens from per-(company, product_model) to per-company.
`b5e9c412d80a` scoped the UNIQUE to the model deliberately, on the theory that
two models genuinely sharing a numbering scheme is legal data. In practice a
serial names one physical unit, and the narrower rule was letting the SAME
number sit on two different models in the same company — which intake's own
`SERIAL_ON_OTHER_PRODUCT` check already treats as wrong for every OTHER vendor
product; the model-scoped UNIQUE was just the one place that same mistake could
still slip past silently when it happened to land on the SAME model's sibling
row twice, or be cleaned up later than it should.

This drops `uq_product_model_serials_model_serial_lower` and replaces it with
`uq_product_model_serials_company_serial_lower (company_id, lower(serial))` —
company-wide. The composite-FK and per-model lookups that the old unique index
also served are kept alive by a new NON-unique index,
`ix_product_model_serials_model_serial_lower`, on the same three columns.

`ix_product_model_serials_company_serial_lower` — the prefix-scan index from
`c7f1a4e93b26`, on `(company_id, lower(serial) text_pattern_ops)` — already
exists and is untouched here; it serves the intake lookup and is a different
opclass, not a substitute for either unique index above.

## This converts a silent gap into a hard failure

`CREATE UNIQUE INDEX` refuses to build while a duplicate exists, so ANY serial
currently sharing a company with another model is now a migration that cannot
run rather than a row that silently slipped through. Run
`python -m app.scripts.audit_duplicate_serials` first and clean up everything
it reports — retype, remove, or merge the duplicate — before applying this.

Hand-written, like its siblings: Alembic does not recognise `LOWER()` indexes
and autogenerate mistakes them for stale, emitting a drop on every run.

Revision ID: d4f8a21b9c56
Revises: a0ede6e6775d
Create Date: 2026-11-03

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d4f8a21b9c56"
down_revision: Union[str, Sequence[str], None] = "a0ede6e6775d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_product_model_serials_model_serial_lower")
    # Non-unique replacement for the composite-FK / per-model lookups the old
    # unique index also served. Columns in the same order it used.
    op.create_index(
        "ix_product_model_serials_model_serial_lower",
        "product_model_serials",
        ["company_id", "product_model_id", sa.text("lower(serial)")],
    )
    # The new rule: one serial, one model, per company. Run
    # app.scripts.audit_duplicate_serials first — this fails outright if any
    # company still has a serial on more than one model.
    op.execute(
        "CREATE UNIQUE INDEX uq_product_model_serials_company_serial_lower "
        "ON product_model_serials (company_id, lower(serial))"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_product_model_serials_company_serial_lower")
    op.drop_index(
        "ix_product_model_serials_model_serial_lower",
        table_name="product_model_serials",
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_product_model_serials_model_serial_lower "
        "ON product_model_serials (company_id, product_model_id, lower(serial))"
    )
