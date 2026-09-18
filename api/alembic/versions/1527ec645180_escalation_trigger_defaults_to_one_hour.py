"""The escalation trigger defaults to one hour

`company_rules.escalate_hours_before_slot` moves from 4 to 1: an unassigned
job now reaches the Area Service Manager an hour before its slot instead of
four. `slot_silence_hours` (still 6) is untouched, and `escalate_before_silence`
still holds for every row — 1 < 6.

Every existing company's row moves to the new number, not only new ones: the
column has never been nullable, so there is no way to tell "a company chose 4
on purpose" from "a company never touched the default" — the two look
identical on the row. Treated the same way the free-credits gift was on launch
day (`e4b9d2a7c1f8`): a one-time value change against every existing row,
alongside the column default a brand-new row will get from here on.

Downgrade puts the column default back but does NOT restore the data: which
rows were genuinely at 4 before this migration ran is exactly the distinction
the paragraph above says cannot be recovered from the column alone.

Revision ID: 1527ec645180
Revises: f2a6c8b93d47
Create Date: 2026-09-18 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "1527ec645180"
down_revision: Union[str, Sequence[str], None] = "f2a6c8b93d47"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "company_rules",
        "escalate_hours_before_slot",
        server_default=sa.text("1"),
    )
    op.execute(
        "UPDATE company_rules SET escalate_hours_before_slot = 1 "
        "WHERE escalate_hours_before_slot <> 1"
    )


def downgrade() -> None:
    op.alter_column(
        "company_rules",
        "escalate_hours_before_slot",
        server_default=sa.text("4"),
    )
