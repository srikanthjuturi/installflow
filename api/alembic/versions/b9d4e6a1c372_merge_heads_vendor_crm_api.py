"""Merge the two open heads: the vendor CRM API chain and the actor-role merge

`f7a3c9e1b254` (vendor CRM API, stacked on the customer-location migration
`e5b81c3d9a27` and so on `b7c3f0a5d9e1`) and `edc6feb031ae` (`ticket_events.actor_role`,
which itself merged `b7c3f0a5d9e1` and `d4f8a21b9c56`) were both heads. This is the
merge, so `alembic upgrade head` works again. It changes nothing in the schema.

NOTE for production: this revision has `d4f8a21b9c56` (serials unique company-wide)
among its ancestors through `edc6feb031ae`, and that one cannot apply to a database
carrying cross-product duplicate serials (see `app.scripts.audit_duplicate_serials`).
A production that has not resolved them can still migrate to
`f7a3c9e1b254` by id, which does not pass through it.

Revision ID: b9d4e6a1c372
Revises: edc6feb031ae, f7a3c9e1b254
Create Date: 2026-11-05
"""
from typing import Sequence, Union


revision: str = "b9d4e6a1c372"
down_revision: Union[str, Sequence[str], None] = ("edc6feb031ae", "f7a3c9e1b254")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
