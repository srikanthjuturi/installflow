"""extra amount at raise (Epic 1.4)

`tickets.extra_amount_paise` / `extra_amount_note`: the vendor's optional extra
charge, stamped at intake, reserved on its credit line and billed at closure as a
Debit Note. Both or neither (CHECK). Autogenerate's drops of the hand-written
LOWER() indexes were deleted.

Revision ID: d44ff497f492
Revises: 685e6eba7da8
Create Date: 2026-10-30 16:08:31.768880

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd44ff497f492'
down_revision: Union[str, Sequence[str], None] = '685e6eba7da8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tickets', sa.Column('extra_amount_paise', sa.Integer(), nullable=True))
    op.add_column('tickets', sa.Column('extra_amount_note', sa.String(length=120), nullable=True))
    op.create_check_constraint(op.f('ck_tickets_extra_amount_has_note'), 'tickets', '(extra_amount_paise IS NULL) = (extra_amount_note IS NULL)')
    op.create_check_constraint(op.f('ck_tickets_extra_amount_paise'), 'tickets', 'extra_amount_paise IS NULL OR extra_amount_paise > 0')


def downgrade() -> None:
    op.drop_constraint(op.f('ck_tickets_extra_amount_paise'), 'tickets', type_='check')
    op.drop_constraint(op.f('ck_tickets_extra_amount_has_note'), 'tickets', type_='check')
    op.drop_column('tickets', 'extra_amount_note')
    op.drop_column('tickets', 'extra_amount_paise')
