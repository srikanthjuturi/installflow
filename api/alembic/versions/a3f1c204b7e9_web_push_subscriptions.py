"""web push subscriptions - reaching a console user with the tab closed

The browser counterpart of `push_tokens`. A console user who turns desktop
alerts on hands over an endpoint at their browser vendor's push service and the
two keys this server encrypts with; that is the whole row.

`endpoint` is UNIQUE on its own rather than per company, for the same reason
`push_tokens.token` is: an endpoint is one browser profile, and if a second
person signs in there the row has to move rather than duplicate. A per-company
unique would permit the duplicate, which is one tenant's escalation text
arriving on another tenant's screen.

Revision ID: a3f1c204b7e9
Revises: 49d390e4d876
Create Date: 2026-08-28 10:14:02.885419

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3f1c204b7e9'
down_revision: Union[str, Sequence[str], None] = '49d390e4d876'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "web_push_subscriptions",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        # No FK, matching notification_reads.user_id — see the model.
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("endpoint", sa.Text(), nullable=False),
        sa.Column("p256dh", sa.String(length=255), nullable=False),
        sa.Column("auth", sa.String(length=255), nullable=False),
        sa.Column("user_agent", sa.String(length=255), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(
            ["company_id"],
            ["companies.id"],
            name=op.f("fk_web_push_subscriptions_company_id_companies"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_web_push_subscriptions")),
        sa.UniqueConstraint("endpoint", name="uq_web_push_subscriptions_endpoint"),
    )
    op.create_index(
        "ix_web_push_subscriptions_company_user",
        "web_push_subscriptions",
        ["company_id", "user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_web_push_subscriptions_company_user",
        table_name="web_push_subscriptions",
    )
    op.drop_table("web_push_subscriptions")
