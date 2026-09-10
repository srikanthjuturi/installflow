"""A pincode can be added by hand

Until now the geography master had exactly one writer: `POST /geo/import`. That
made a missing pincode expensive — `_assert_pincode_known` refuses intake for a
code the master does not hold, and the only remedy was to edit the source
spreadsheet and re-upload all 19,496 rows.

The console can now add and correct one directly. `source` is what keeps that
honest.

**Why the column has to exist.** The importer is *additive*: it creates and
updates what the file names and never deletes what the file omits. So a code
added by hand, which the spreadsheet has never heard of, survives every future
upload — permanently. Nothing else in the row distinguishes it (`created_by` is
stamped by the importer too, with the same kind of id), so without this column
nobody reconciling the sheet later could find the rows it does not cover.

`server_default` does the backfill in the ALTER itself: every existing row came
from the sheet, so 'import' is not an invented value, it is the true one.

Revision ID: d1a7c35e9b42
Revises: c7f1a4e93b26
Create Date: 2026-09-10

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "d1a7c35e9b42"
down_revision: Union[str, Sequence[str], None] = "c7f1a4e93b26"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "pincodes",
        sa.Column(
            "source",
            sa.String(length=8),
            nullable=False,
            server_default=sa.text("'import'"),
        ),
    )
    # The convention prepends ck_pincodes_, so the name here is the bare word --
    # passing the full name produces ck_pincodes_ck_pincodes_source.
    op.create_check_constraint(
        "source", "pincodes", "source IN ('import', 'manual')"
    )


def downgrade() -> None:
    # The bare name here too -- the convention prepends ck_pincodes_ on the way
    # out as well as on the way in.
    op.drop_constraint("source", "pincodes", type_="check")
    op.drop_column("pincodes", "source")
