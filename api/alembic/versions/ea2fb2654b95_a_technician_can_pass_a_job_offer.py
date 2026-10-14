"""A technician can pass a job offer

Pass on the app's offer screen used to go back a screen and record nothing, so
the job was in that technician's pool again on the next refresh. `job_passes`
is one row per technician per job they declined; `pool_query` and the pool push
leave the job out for them.

The row carries the ticket's `slot_start` and `bonus_paise` at the moment of
the pass. The job is hidden only while the ticket still carries those two, so a
new time or a new bonus brings it back without any other writer having to know
this table exists. See `app/models/job_pass.py`.

Purely additive: no existing row is touched, nothing is backfilled (nobody has
passed anything yet), and the downgrade only drops the new table.

Autogenerate also proposed dropping every hand-written functional and partial
index (`uq_companies_gst_lower`, `uq_companies_slug_lower`, `uq_users_email_lower`,
`ix_tickets_pool` and the rest) and a `platform_settings.id` default — the usual
false positives in api/AGENTS.md hard rule 6. All removed.

Revision ID: ea2fb2654b95
Revises: b8e3f14a9c27
Create Date: 2026-10-13 14:48:14.911980

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ea2fb2654b95'
down_revision: Union[str, Sequence[str], None] = 'b8e3f14a9c27'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'job_passes',
        sa.Column('company_id', sa.Uuid(), nullable=False),
        sa.Column('ticket_id', sa.Uuid(), nullable=False),
        sa.Column('technician_id', sa.Uuid(), nullable=False),
        sa.Column('slot_start', sa.DateTime(timezone=True), nullable=True),
        sa.Column('bonus_paise', sa.Integer(), nullable=True),
        sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.Uuid(), nullable=True),
        sa.Column('updated_by', sa.Uuid(), nullable=True),
        sa.CheckConstraint(
            'bonus_paise IS NULL OR bonus_paise > 0', name=op.f('ck_job_passes_bonus_paise')
        ),
        # Composite, so a pass can never name another company's technician or
        # ticket (hard rule 1).
        sa.ForeignKeyConstraint(
            ['company_id', 'technician_id'],
            ['technician_profiles.company_id', 'technician_profiles.id'],
            name='fk_job_passes_company_technician',
            ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['company_id', 'ticket_id'],
            ['tickets.company_id', 'tickets.id'],
            name='fk_job_passes_company_ticket',
            ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['company_id'],
            ['companies.id'],
            name=op.f('fk_job_passes_company_id_companies'),
            ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_job_passes')),
        # One per technician per job, and the covering index for both the
        # `(company_id, ticket_id)` and `company_id` foreign keys.
        sa.UniqueConstraint(
            'company_id', 'ticket_id', 'technician_id', name='uq_job_passes_ticket_technician'
        ),
    )
    # Covers the `(company_id, technician_id)` foreign key.
    op.create_index(
        'ix_job_passes_company_technician',
        'job_passes',
        ['company_id', 'technician_id'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index('ix_job_passes_company_technician', table_name='job_passes')
    op.drop_table('job_passes')
