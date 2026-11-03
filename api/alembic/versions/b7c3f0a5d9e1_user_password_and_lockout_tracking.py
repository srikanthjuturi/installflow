"""User password and lockout tracking

Adds five columns to `users` in support of password hygiene and brute-force
lockout: `password_changed_at` (when the password was last changed — NULL
means never tracked, deliberately no backfill), `failed_login_attempts` and
`failed_login_locked_until` (a simple counter-and-timestamp lockout), and
`must_change_password` / `requires_security_password_change` (two independent
reasons a sign-in can be forced into a password change — one set by an admin
reissuing a password, the other by a security event).

Hand-written, like its siblings: autogenerate would try to drop
`uq_users_email_lower`, the case-insensitive functional index on
`lower(email)`, which Alembic does not recognise and mistakes for stale.

Revision ID: b7c3f0a5d9e1
Revises: a0ede6e6775d
Create Date: 2026-11-03

NOTE: branched directly off `a0ede6e6775d` rather than stacking on
`d4f8a21b9c56` (the serials-unique-company-wide migration) — that one
cannot apply to a database carrying pre-existing cross-product duplicate
serials until those are resolved (see `app.scripts.audit_duplicate_serials`),
and this one must not be blocked by that unrelated decision. Merge the two
heads once the serials migration has actually been applied.

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b7c3f0a5d9e1"
down_revision: Union[str, Sequence[str], None] = "a0ede6e6775d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column(
            "failed_login_attempts",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "failed_login_locked_until", sa.DateTime(timezone=True), nullable=True
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "must_change_password",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "requires_security_password_change",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "requires_security_password_change")
    op.drop_column("users", "must_change_password")
    op.drop_column("users", "failed_login_locked_until")
    op.drop_column("users", "failed_login_attempts")
    op.drop_column("users", "password_changed_at")
