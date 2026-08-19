"""A membership can name the vendor it acts for.

`memberships.vendor_id` is what makes a vendor an account. It is nullable —
staff and technicians have none — and it carries a COMPOSITE foreign key on
`(company_id, vendor_id)`, so a login in one company can never name a vendor in
another. That is hard rule 1, and it is the reason this column is here rather
than in either of the two more obvious places:

  * `vendors.user_id` — one column holds one user, and a vendor has several
    logins the moment it creates a sub-user.
  * `users.vendor_id` — `users` has no `company_id`, so the FK could only be
    single-column and nothing would constrain the pair. `audit_tenancy` would
    report it, correctly.

RESTRICT on delete, not CASCADE: removing a vendor must not silently delete the
accounts that raised its tickets. `delete_vendor` deactivates the memberships
deliberately instead, so the history keeps its authors and the rows can be
brought back if the removal was a mistake.
"""

import sqlalchemy as sa
from alembic import op

revision = "a1b7e9f4c206"
down_revision = "d5f61c07ab29"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("memberships", sa.Column("vendor_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_memberships_company_vendor",
        "memberships",
        "vendors",
        ["company_id", "vendor_id"],
        ["company_id", "id"],
        ondelete="RESTRICT",
    )
    # Covers the FK — so deleting a vendor does not scan every membership in the
    # database to prove the RESTRICT holds — and answers "who logs in for this
    # vendor", which the portal asks on every request.
    op.create_index(
        "ix_memberships_company_vendor", "memberships", ["company_id", "vendor_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_memberships_company_vendor", table_name="memberships")
    op.drop_constraint("fk_memberships_company_vendor", "memberships", type_="foreignkey")
    op.drop_column("memberships", "vendor_id")
