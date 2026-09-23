"""Push tokens remember the phone's language

`push_tokens.language` is the language the technician app is showing on that
phone — `en`, `hi`, `te`, `kn` or `ta` — sent with every registration, so a
push notification is written in it (`app/core/push_text.py`). When the app is
closed Android draws the title and body exactly as the server sent them; the
phone cannot translate a push the way it translates its own screens.

Per device, not per person, because that is what the app's setting is: it
belongs to the handset and survives sign-out. A column on the token row is
therefore the exact shape of the thing it copies, and it needs no second
query — the sender already reads this row to find where to send.

NOT NULL with a server default of `en`, so every existing row reads as
English — which is right, since every app build that registered one before
today could only show English — and so the running API, which knows nothing
of this column, keeps inserting rows unchanged. That is what lets production
be migrated before the new code is published, in that order, as
`api/AGENTS.md` → Environments requires.

The CHECK is the same list as `push_text.LANGUAGES`. The API normalises
anything else to `en` before it writes, so a later app with a sixth language
registers fine and reads English until this list and the translations grow.

Downgrade drops the column and its CHECK; nothing else depends on it.

Revision ID: 70cdde973bb1
Revises: 1527ec645180
Create Date: 2026-09-22 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "70cdde973bb1"
down_revision: Union[str, Sequence[str], None] = "1527ec645180"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "push_tokens",
        sa.Column("language", sa.String(length=8), server_default="en", nullable=False),
    )
    op.create_check_constraint(
        # Bare name — the naming convention adds the `ck_push_tokens_` prefix.
        "language",
        "push_tokens",
        "language IN ('en', 'hi', 'te', 'kn', 'ta')",
    )


def downgrade() -> None:
    op.drop_constraint("language", "push_tokens", type_="check")
    op.drop_column("push_tokens", "language")
