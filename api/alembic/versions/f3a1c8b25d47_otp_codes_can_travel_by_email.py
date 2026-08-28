"""otp_codes can travel by email

A one-time code has only ever gone to a phone: `otp_codes.phone` was NOT NULL,
the code hash was salted with it, and all three throttle counters read that
column. Console staff who forget their password need the same machinery pointed
at an email address, so this widens the table from "a code sent to a phone" to
"a code sent to a destination" instead of standing a second table beside it.

A second table was the alternative and it is the worse one. Everything that
makes a one-time code safe — the pepper, the ten-minute TTL, the five-attempt
burn, the resend cooldown, the per-window and per-IP counters, and the rule that
a new request kills the live code — would have had to exist twice, and the two
copies would drift the first time one of those numbers was tuned.

`phone` therefore becomes nullable, `email` appears beside it, and a CHECK says
exactly one of them is set. Neither would be a code nobody could ever receive;
both would make "which rows count against this throttle" a question with two
answers, and the answer would differ by caller.

The `wa_` prefixes go at the same time. Azure Communication Services writes
those two columns now as well as WhatsApp, so they become `provider_message_id`
and `send_error`. `technician_invites` keeps its own `wa_*` pair untouched — an
invite really does only travel by WhatsApp.

Revision ID: f3a1c8b25d47
Revises: c7b2e91d4f68
Create Date: 2026-08-28 14:20:11.482915

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f3a1c8b25d47"
down_revision: Union[str, Sequence[str], None] = "c7b2e91d4f68"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_PURPOSE_OLD = "purpose IN ('login','invite')"
_PURPOSE_NEW = "purpose IN ('login','invite','password_reset')"
_DESTINATION = "num_nonnulls(phone, email) = 1"


def upgrade() -> None:
    op.add_column(
        "otp_codes", sa.Column("email", sa.String(length=320), nullable=True)
    )
    op.alter_column(
        "otp_codes", "phone", existing_type=sa.String(length=20), nullable=True
    )

    op.alter_column(
        "otp_codes", "wa_message_id", new_column_name="provider_message_id"
    )
    op.alter_column("otp_codes", "wa_error", new_column_name="send_error")

    op.drop_constraint("purpose", "otp_codes", type_="check")
    op.create_check_constraint("purpose", "otp_codes", _PURPOSE_NEW)
    op.create_check_constraint("destination", "otp_codes", _DESTINATION)

    # The email twin of ix_otp_codes_phone_created. Every throttle counter and
    # every verification keys on the destination, so without it each one
    # sequentially scans a table that only ever grows.
    op.create_index(
        "ix_otp_codes_email_created", "otp_codes", ["email", "created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_otp_codes_email_created", table_name="otp_codes")
    op.drop_constraint("destination", "otp_codes", type_="check")

    # Every email-addressed code — which is every password reset — is a row the
    # restored NOT NULL cannot hold. They are spent or expiring one-time codes,
    # never anything a person could need again, so deleting them costs nothing;
    # leaving them would make `phone SET NOT NULL` fail and turn this downgrade
    # into a dead end.
    op.execute("DELETE FROM otp_codes WHERE email IS NOT NULL OR phone IS NULL")

    op.drop_constraint("purpose", "otp_codes", type_="check")
    op.create_check_constraint("purpose", "otp_codes", _PURPOSE_OLD)

    op.alter_column("otp_codes", "send_error", new_column_name="wa_error")
    op.alter_column(
        "otp_codes", "provider_message_id", new_column_name="wa_message_id"
    )

    op.drop_column("otp_codes", "email")
    op.alter_column(
        "otp_codes", "phone", existing_type=sa.String(length=20), nullable=False
    )
