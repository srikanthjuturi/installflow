"""One address box for a company, like a vendor's

The company form asked for a street address in two boxes; the vendor form asks
for it in one, keeps the line breaks, and is the shape both now use. So line 2
stops being a field — and rather than leave a column nothing writes to (hard
rule 8's smell, one level down), its contents are folded into line 1 and the
column is dropped.

Nothing is lost on the way up. `address_line1` widens to 500 first — matching
`vendors.address`, which has always been one box — and the two lines are joined
with a NEWLINE, because that is exactly what the textarea preserves and what a
letterhead address looks like when pasted.

⚠ The downgrade is LOSSY, unavoidably: it re-creates an empty `address_line2`
and truncates `address_line1` back to 255. Nothing can un-fold two lines that
have become one, since a newline inside line 1 was always legal. The round trip
is structurally clean; the data is not, and that is worth knowing before running
it against anything real.

Revision ID: e6b40d92c7a5
Revises: d3f27a8c1904
Create Date: 2026-08-31

"""

from alembic import op
import sqlalchemy as sa

revision = "e6b40d92c7a5"
down_revision = "d3f27a8c1904"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Widen BEFORE folding: two full 255-character lines plus a separator do not
    # fit in 255, and a migration that fails on a long address is worse than one
    # that plans for it.
    op.alter_column(
        "companies",
        "address_line1",
        existing_type=sa.String(length=255),
        type_=sa.String(length=500),
        existing_nullable=False,
    )

    # `left(..., 500)` is belt and braces — 511 characters is the theoretical
    # worst case and no real address comes close, but the alternative is a
    # deploy that stops on one row somebody typed twice into.
    op.execute(
        """
        UPDATE companies
           SET address_line1 = left(address_line1 || chr(10) || address_line2, 500)
         WHERE address_line2 IS NOT NULL
           AND btrim(address_line2) <> ''
        """
    )

    op.drop_column("companies", "address_line2")


def downgrade() -> None:
    op.add_column(
        "companies",
        sa.Column("address_line2", sa.String(length=255), nullable=True),
    )
    # The fold cannot be undone — see the module docstring. Truncate so the
    # narrower type can be restored at all.
    op.execute("UPDATE companies SET address_line1 = left(address_line1, 255)")
    op.alter_column(
        "companies",
        "address_line1",
        existing_type=sa.String(length=500),
        type_=sa.String(length=255),
        existing_nullable=False,
    )
