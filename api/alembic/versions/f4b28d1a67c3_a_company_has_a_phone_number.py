"""A company has a phone number

`companies.phone` was the one optional box on the superadmin's create form, and
the only contact route a company had left when its admin mailbox bounced. It is
mandatory now, on the same footing as `vendors.phone`, which has been NOT NULL
since vendors existed.

## Why there is no backfill

Every other retrofit in this directory could fill its column from something the
database already held — a vendor's PAN is literally characters 3-12 of its
GSTIN. A phone number has no such source. There is nothing to derive it from,
and no placeholder that is not a lie: a company row carrying `+910000000000`
would be a number somebody eventually dials.

So this migration **refuses to run** while any company lacks one, and names the
rows. The fix is thirty seconds on Super Admin → Companies → Edit, against the
still-unmigrated API, which accepts a phone today and simply did not insist.

That was affordable to demand because there was nothing to convert. Measured
when this was written: `RelianceDB` held zero companies, and `RelianceProdDB`
held zero one day earlier, when `e6a3f91c72b8` counted them. So the guard has
never yet had a row to refuse — it exists for the environments that will.

A soft-deleted company is checked too — NOT NULL does not exempt hidden rows,
and a restored company with no phone would be a row nothing could ever fix. It
is also the one case the console cannot repair, so the refusal spells out the
UPDATE for it.

## Migrate before publishing

`Company.phone` is now `Mapped[str]`, and `CompanyOut.phone` a plain `str`. An
API published against an unmigrated database keeps working — a nullable column
satisfies a NOT NULL model — right up to the first company whose phone is null,
which then fails validation on the companies list rather than on one row.

Revision ID: f4b28d1a67c3
Revises: e6a3f91c72b8
Create Date: 2026-09-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f4b28d1a67c3"
down_revision: Union[str, Sequence[str], None] = "e6a3f91c72b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


#: Blank counts as missing. The request layer maps `""` to NULL, so a blank
#: should not exist — but `SET NOT NULL` would happily accept one, and an empty
#: string passing for a phone number is exactly the outcome this revision is
#: meant to prevent.
_MISSING = "phone IS NULL OR btrim(phone) = ''"


def _refuse_if_unreachable() -> None:
    rows = (
        op.get_bind()
        .execute(
            sa.text(
                f"""
                SELECT name, deleted_at IS NOT NULL AS is_deleted
                  FROM companies
                 WHERE {_MISSING}
                 ORDER BY created_at
                """
            )
        )
        .all()
    )
    if not rows:
        return

    listed = "\n".join(
        f"  - {r.name}" + (" (deleted - see below)" if r.is_deleted else "")
        for r in rows
    )
    # ASCII only, deliberately. This message is read on a Windows console, whose
    # code page turns an em dash into `?` and an arrow into a literal `→` —
    # which is a poor way to learn what to do next.
    raise RuntimeError(
        "companies.phone cannot be made NOT NULL: these companies have no "
        f"phone number.\n{listed}\n\n"
        "Set one on Super Admin > Companies > Edit, then run this migration "
        "again. A deleted company has no screen; give it a real number by hand:\n"
        "  UPDATE companies SET phone = '+919xxxxxxxxx' WHERE name = '...';"
    )


def upgrade() -> None:
    _refuse_if_unreachable()
    op.alter_column(
        "companies",
        "phone",
        existing_type=sa.String(length=32),
        nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "companies",
        "phone",
        existing_type=sa.String(length=32),
        nullable=True,
    )
