"""franchise settlements and finance features (Epic 1.2)

The company <-> franchisee transfer ledger, plus the four feature keys Epic 1
needs (seeded once so 1.5-1.7 need no further feature migration). Autogenerate's
drops of the hand-written LOWER() indexes were deleted.

Revision ID: 685e6eba7da8
Revises: 963fc5235985
Create Date: 2026-10-30 15:53:14.926779

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '685e6eba7da8'
down_revision: Union[str, Sequence[str], None] = '963fc5235985'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None



FEATURES = [
    ("finance.settlements", "Franchise Settlements", None, 120),
    ("finance.transactions", "Transactions", None, 121),
    ("franchise.settlements", "Franchise Settlements (portal)", None, 108),
    ("franchise.documents", "Franchise Documents", None, 109),
]
DEFAULTS = {
    "finance.settlements": ["admin", "national_head"],
    "finance.transactions": ["admin", "national_head"],
    "franchise.settlements": ["franchisee_admin"],
    "franchise.documents": ["franchisee_admin"],
}


def upgrade() -> None:
    op.create_table('franchise_settlements',
    sa.Column('company_id', sa.Uuid(), nullable=False),
    sa.Column('franchisee_id', sa.Uuid(), nullable=False),
    sa.Column('code', sa.String(length=32), nullable=False),
    sa.Column('direction', sa.String(length=24), nullable=False),
    sa.Column('amount_paise', sa.Integer(), nullable=False),
    sa.Column('reason', sa.String(length=16), nullable=False),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('transferred_on', sa.Date(), nullable=False),
    sa.Column('utr', sa.String(length=35), nullable=True),
    sa.Column('proof_blob_name', sa.String(length=255), nullable=False),
    sa.Column('recorded_by_user_id', sa.Uuid(), nullable=True),
    sa.Column('recorded_by_label', sa.String(length=120), nullable=True),
    sa.Column('confirmed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('confirmed_by_user_id', sa.Uuid(), nullable=True),
    sa.Column('confirmed_by_label', sa.String(length=120), nullable=True),
    sa.Column('declined_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('declined_by_user_id', sa.Uuid(), nullable=True),
    sa.Column('declined_by_label', sa.String(length=120), nullable=True),
    sa.Column('decline_reason', sa.String(length=160), nullable=True),
    sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('created_by', sa.Uuid(), nullable=True),
    sa.Column('updated_by', sa.Uuid(), nullable=True),
    sa.CheckConstraint("direction IN ('company_to_franchisee', 'franchisee_to_company')", name=op.f('ck_franchise_settlements_direction')),
    sa.CheckConstraint("reason <> 'other' OR note IS NOT NULL", name=op.f('ck_franchise_settlements_other_has_note')),
    sa.CheckConstraint("reason IN ('lease', 'revenue_share', 'advance', 'adjustment', 'other')", name=op.f('ck_franchise_settlements_reason')),
    sa.CheckConstraint('NOT (confirmed_at IS NOT NULL AND declined_at IS NOT NULL)', name=op.f('ck_franchise_settlements_decided_once')),
    sa.CheckConstraint('amount_paise > 0', name=op.f('ck_franchise_settlements_amount_paise')),
    sa.CheckConstraint('declined_at IS NULL OR decline_reason IS NOT NULL', name=op.f('ck_franchise_settlements_decline_has_reason')),
    sa.ForeignKeyConstraint(['company_id', 'franchisee_id'], ['franchisees.company_id', 'franchisees.id'], name='fk_franchise_settlements_franchisee', ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['company_id'], ['companies.id'], name=op.f('fk_franchise_settlements_company_id_companies'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_franchise_settlements')),
    sa.UniqueConstraint('company_id', 'code', name='uq_franchise_settlements_company_code'),
    sa.UniqueConstraint('company_id', 'id', name='uq_franchise_settlements_company_id_id')
    )
    op.create_index('ix_franchise_settlements_company_created', 'franchise_settlements', ['company_id', 'created_at'], unique=False)
    op.create_index('ix_franchise_settlements_franchisee', 'franchise_settlements', ['company_id', 'franchisee_id', 'created_at'], unique=False)
    bind = op.get_bind()
    for key, label, parent, sort in FEATURES:
        bind.execute(sa.text(
            "INSERT INTO features (key, label, parent_key, sort_order) "
            "SELECT CAST(:key AS varchar), CAST(:label AS varchar), CAST(:parent AS varchar), "
            "CAST(:sort AS integer) WHERE NOT EXISTS (SELECT 1 FROM features WHERE key = :key)"),
            {"key": key, "label": label, "parent": parent, "sort": sort})
    for key, roles in DEFAULTS.items():
        for role in roles:
            bind.execute(sa.text(
                "INSERT INTO role_feature_defaults (role, feature_id, enabled) "
                "SELECT CAST(:role AS varchar), f.id, true FROM features f WHERE f.key = :key "
                "AND NOT EXISTS (SELECT 1 FROM role_feature_defaults d "
                "WHERE d.role = CAST(:role AS varchar) AND d.feature_id = f.id)"),
                {"role": role, "key": key})


def downgrade() -> None:
    bind = op.get_bind()
    keys = [k for k, _, _, _ in FEATURES]
    for table in ("company_role_features", "role_feature_defaults"):
        bind.execute(sa.text(
            f"DELETE FROM {table} WHERE feature_id IN "
            "(SELECT id FROM features WHERE key = ANY(:k))"), {"k": keys})
    bind.execute(sa.text("DELETE FROM features WHERE key = ANY(:k)"), {"k": keys})
    op.drop_index('ix_franchise_settlements_franchisee', table_name='franchise_settlements')
    op.drop_index('ix_franchise_settlements_company_created', table_name='franchise_settlements')
    op.drop_table('franchise_settlements')
