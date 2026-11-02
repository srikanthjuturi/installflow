"""parts delivery address (Epic 6)

`technician_profiles.parts_*` (a postal address for spare parts, all or none) and
`spare_part_requests.delivery_address` (a JSONB copy taken when the request is
raised). Autogenerate's drops of the hand-written LOWER() indexes were deleted.

Revision ID: 57938571d780
Revises: dc427aa6df78
Create Date: 2026-10-30 17:22:44.341796

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '57938571d780'
down_revision: Union[str, Sequence[str], None] = 'dc427aa6df78'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('spare_part_requests', sa.Column('delivery_address', postgresql.JSONB(none_as_null=True, astext_type=sa.Text()), nullable=True))
    op.drop_index(op.f('uq_spare_parts_model_name'), table_name='spare_parts', postgresql_where='((model_id IS NOT NULL) AND (deleted_at IS NULL))')
    op.drop_index(op.f('uq_spare_parts_node_name'), table_name='spare_parts', postgresql_where='((node_id IS NOT NULL) AND (deleted_at IS NULL))')
    op.add_column('technician_profiles', sa.Column('parts_address_line', sa.String(length=240), nullable=True))
    op.add_column('technician_profiles', sa.Column('parts_city', sa.String(length=80), nullable=True))
    op.add_column('technician_profiles', sa.Column('parts_pincode', sa.String(length=6), nullable=True))
    op.add_column('technician_profiles', sa.Column('parts_landmark', sa.String(length=120), nullable=True))
    op.add_column('technician_profiles', sa.Column('parts_contact_phone', sa.String(length=20), nullable=True))
    op.add_column('technician_profiles', sa.Column('parts_address_set_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('technician_profiles', sa.Column('parts_address_set_by_user_id', sa.Uuid(), nullable=True))
    op.create_index('ix_technician_profiles_parts_pincode', 'technician_profiles', ['parts_pincode'], unique=False)
    op.create_index('ix_technician_profiles_parts_set_by', 'technician_profiles', ['parts_address_set_by_user_id'], unique=False)
    op.create_foreign_key(op.f('fk_technician_profiles_parts_pincode_pincodes'), 'technician_profiles', 'pincodes', ['parts_pincode'], ['code'], ondelete='RESTRICT')
    op.create_foreign_key(op.f('fk_technician_profiles_parts_address_set_by_user_id_users'), 'technician_profiles', 'users', ['parts_address_set_by_user_id'], ['id'], ondelete='SET NULL')
    op.create_check_constraint(op.f('ck_technician_profiles_parts_address_all_or_none'), 'technician_profiles', '(parts_address_line IS NULL) = (parts_city IS NULL) AND (parts_address_line IS NULL) = (parts_pincode IS NULL)')


def downgrade() -> None:
    op.drop_constraint(op.f('ck_technician_profiles_parts_address_all_or_none'), 'technician_profiles', type_='check')
    op.drop_constraint(op.f('fk_technician_profiles_parts_address_set_by_user_id_users'), 'technician_profiles', type_='foreignkey')
    op.drop_constraint(op.f('fk_technician_profiles_parts_pincode_pincodes'), 'technician_profiles', type_='foreignkey')
    op.drop_index('ix_technician_profiles_parts_set_by', table_name='technician_profiles')
    op.drop_index('ix_technician_profiles_parts_pincode', table_name='technician_profiles')
    op.drop_column('technician_profiles', 'parts_address_set_by_user_id')
    op.drop_column('technician_profiles', 'parts_address_set_at')
    op.drop_column('technician_profiles', 'parts_contact_phone')
    op.drop_column('technician_profiles', 'parts_landmark')
    op.drop_column('technician_profiles', 'parts_pincode')
    op.drop_column('technician_profiles', 'parts_city')
    op.drop_column('technician_profiles', 'parts_address_line')
    op.create_index(op.f('uq_spare_parts_node_name'), 'spare_parts', ['company_id', 'node_id', sa.literal_column('lower(btrim(name::text))')], unique=True, postgresql_where='((node_id IS NOT NULL) AND (deleted_at IS NULL))')
    op.create_index(op.f('uq_spare_parts_model_name'), 'spare_parts', ['company_id', 'model_id', sa.literal_column('lower(btrim(name::text))')], unique=True, postgresql_where='((model_id IS NOT NULL) AND (deleted_at IS NULL))')
    op.drop_column('spare_part_requests', 'delivery_address')
