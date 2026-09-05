"""A field template on the last sub-category.

`product_models.parameters` already lets a product carry free-text specs — RAM,
panel type, whatever ops record. Naming those fields on every product was the
problem: the same six labels retyped for every unit in the range, and one typo
away from `RAM` and `Ram` being two different things across a catalogue.

`product_nodes.parameters` is the TEMPLATE they start from. The last
sub-category lists the field names once, optionally with a default value, and
`ModelFormDialog` opens a new product with those rows ready to fill in.

## A template, not inheritance

The product owns what it saves. Editing this list changes what the NEXT product
starts from; it does not touch products that already exist, and nothing is
merged at read time.

That distinction is the whole reason this column looks the way it does. The
first cut of the feature DID inherit — the category's specs merged into every
product beneath it, nearest winning — and it was removed a few hours earlier the
same day. Two things were wrong with it: every reader had to know a precedence
rule, and correcting a category silently restated what a technician had already
been told about a job they had finished.

## Only a leaf may carry one

A node that is not the last sub-category holds no products, so a template on it
describes nothing. `ck_product_nodes_template_only_on_leaf` says so rather than
leaving it to the service layer, because a row that can never be read is exactly
the kind of thing that survives a refactor.

## Why this is its own migration

`a7c93f5e2b18` added the column in an earlier draft, and that draft was already
applied to a database somebody was entering a catalogue into. Editing an applied
migration is only free while the data is disposable — it stopped being free the
moment there were rows worth keeping, and once already cost a real row. So the
column arrives on top instead.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "b8d41e07c592"
down_revision: Union[str, Sequence[str], None] = "a7c93f5e2b18"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


#: Entries in one template. Mirrors `core.product_tree.MAX_PARAMETERS`.
MAX_PARAMETERS = 20


def upgrade() -> None:
    op.add_column(
        "product_nodes",
        sa.Column(
            "parameters",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )
    # SHAPE and arity only. Bounding each entry means walking the array with
    # `jsonb_array_elements`, a set-returning function, and Postgres refuses a
    # subquery inside a CHECK — the same split `product_models.parameters` and
    # `image_urls` already make. Names, lengths and case-insensitive uniqueness
    # are enforced in `masters/schemas.py`.
    op.create_check_constraint(
        "parameters",
        "product_nodes",
        f"jsonb_typeof(parameters) = 'array' "
        f"AND jsonb_array_length(parameters) <= {MAX_PARAMETERS}",
    )
    # Every existing node defaults to an empty template, so this holds on the
    # way in whatever the catalogue already looks like.
    op.create_check_constraint(
        "template_only_on_leaf",
        "product_nodes",
        "is_leaf OR jsonb_array_length(parameters) = 0",
    )


def downgrade() -> None:
    # BARE names. The naming convention is applied on the way out too, so
    # passing `ck_product_nodes_parameters` here produces
    # `ck_product_nodes_ck_product_nodes_parameters` — the trap `e6a3f91c72b8`
    # documented for `create_check_constraint`, which bites identically on drop.
    op.drop_constraint("template_only_on_leaf", "product_nodes", type_="check")
    op.drop_constraint("parameters", "product_nodes", type_="check")
    op.drop_column("product_nodes", "parameters")
