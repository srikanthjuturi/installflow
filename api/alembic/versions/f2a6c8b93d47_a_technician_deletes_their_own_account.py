"""A technician deletes their own account

Google Play requires an in-app way for a user to delete an account they
created themselves, which is how every invited technician gets one. The
account cannot be hard-deleted once it has any ticket, ledger or redemption
history — those foreign keys are RESTRICT, and `users` is never hard-deleted
either (`ActorMixin`'s stated invariant) — so this is the same soft-remove a
manager already performs from the console (`DELETE /technicians/{id}`), just
self-triggered and proved with a code to the technician's own registered
number instead of an Area Manager's say-so.

  * `otp_codes.purpose = 'self_delete'` — the sixth purpose, same shape as
    `payout_account`: a code to the technician's OWN WhatsApp, read from their
    account, never from the request.

No new table: the removal itself reuses `memberships.deleted_at` and
`technician_profiles.status`, exactly as the existing manager-initiated
delete already does.

Revision ID: f2a6c8b93d47
Revises: e4b9d2a7c1f8
Create Date: 2026-09-17 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "f2a6c8b93d47"
down_revision: Union[str, Sequence[str], None] = "e4b9d2a7c1f8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

#: As the database stands before this revision — spelled out, not imported.
_PURPOSE_OLD = (
    "purpose IN ('login','invite','password_reset','reschedule','payout_account')"
)
_PURPOSE_NEW = (
    "purpose IN ('login','invite','password_reset','reschedule','payout_account',"
    "'self_delete')"
)


def upgrade() -> None:
    op.drop_constraint("purpose", "otp_codes", type_="check")
    op.create_check_constraint("purpose", "otp_codes", _PURPOSE_NEW)


def downgrade() -> None:
    # Spent or expiring one-time codes — never anything a person needs again.
    op.execute("DELETE FROM otp_codes WHERE purpose = 'self_delete'")
    op.drop_constraint("purpose", "otp_codes", type_="check")
    op.create_check_constraint("purpose", "otp_codes", _PURPOSE_OLD)
