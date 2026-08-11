"""product model capacity and warranty

Revision ID: d2a6e47420a1
Revises: 79bab1e4577f
Create Date: 2026-08-11

Two facts a product model carries that were previously buried in its name or
nowhere at all.

`capacity` is the size or rating — 43 inch, 7 kg, 340 L. It lives in the display
name today ('43" 4K UHD'), which makes it unsortable, unfilterable, and
impossible to show on its own anywhere else.

`warranty_months` is what a technician standing in front of the unit gets asked
and what a later claim quotes.

Both nullable: a model is worth recording as soon as it has a name, and ops fill
these in as they learn them. A half-known model still lets a ticket reference it,
which is the point.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd2a6e47420a1'
down_revision: Union[str, Sequence[str], None] = '79bab1e4577f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "product_models", sa.Column("capacity", sa.String(length=64), nullable=True)
    )
    op.add_column(
        "product_models", sa.Column("warranty_months", sa.SmallInteger(), nullable=True)
    )
    # 20 years is well past any consumer appliance; the ceiling exists to catch
    # someone typing a year count into a months field.
    op.create_check_constraint(
        "ck_product_models_warranty_months",
        "product_models",
        "warranty_months IS NULL OR warranty_months BETWEEN 0 AND 240",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        "ck_product_models_warranty_months", "product_models", type_="check"
    )
    op.drop_column("product_models", "warranty_months")
    op.drop_column("product_models", "capacity")
