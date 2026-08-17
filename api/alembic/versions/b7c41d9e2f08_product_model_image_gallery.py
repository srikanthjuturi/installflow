"""product model image gallery

Revision ID: b7c41d9e2f08
Revises: 45a469be61db
Create Date: 2026-08-17

One photo per model was never enough to recognise a unit: ops want the front,
the label and the box. `image_url` becomes `image_urls`, an ordered JSONB list
capped at five by the schema layer, whose first entry is the thumbnail every
list already draws.

JSONB rather than a `product_model_photos` child table: the list is bounded,
always read whole with its model and never queried on its own, so a join would
buy nothing and cost another composite-FK relationship to keep tenant-safe.

The round trip is lossless in the direction that matters — upgrade wraps the
existing URL in a one-element list, downgrade keeps the first and drops the
rest, which is exactly the data a single column can hold.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'b7c41d9e2f08'
down_revision: Union[str, Sequence[str], None] = '45a469be61db'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "product_models",
        sa.Column(
            "image_urls",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    # A model that had a photo keeps it, as the first of its gallery.
    op.execute(
        """
        UPDATE product_models
           SET image_urls = jsonb_build_array(image_url)
         WHERE image_url IS NOT NULL AND image_url <> ''
        """
    )
    op.drop_column("product_models", "image_url")


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column(
        "product_models", sa.Column("image_url", sa.Text(), nullable=True)
    )
    op.execute(
        """
        UPDATE product_models
           SET image_url = image_urls ->> 0
         WHERE jsonb_array_length(image_urls) > 0
        """
    )
    op.drop_column("product_models", "image_urls")
