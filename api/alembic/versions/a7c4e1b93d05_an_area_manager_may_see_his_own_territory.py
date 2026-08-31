"""An area manager may see his own territory

`territory.view` was granted to admin, national head and regional head, and to
nobody else. An area manager therefore got a 403 from `GET /territory` and the
Territory page showed him nothing at all — not even the states he personally
covers, which are the one part of that map he is accountable for.

It reads as an oversight rather than a decision. `get_territory` already has an
area-manager branch (`isMine` is true for `s.id in own.state_ids`, false for a
colleague's state in the same region), `territory_scope` already admits the
caller's own membership so he can find himself, and the console's map already
computes `minePartial` for the express purpose of distinguishing an area
manager's states from his colleagues'. Three layers were written for a caller
the feature gate never let through.

Nothing here grants a new power. The page is read-only by construction: the
mapping is made by assigning regions and states on Users & roles, which stays
behind `users.edit` and a rank floor. This lets him look at the map he is
already on.

Revision ID: a7c4e1b93d05
Revises: f3a1c8b25d47
Create Date: 2026-08-31 10:42:18.907341

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a7c4e1b93d05"
down_revision: Union[str, Sequence[str], None] = "f3a1c8b25d47"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_ROLE = "area_manager"
_FEATURE = "territory.view"


def upgrade() -> None:
    # WHERE NOT EXISTS rather than a plain INSERT: a company may already have
    # granted this through `company_role_features`, and a database stood up
    # from a later seed could already carry the row. Re-running must be inert.
    op.get_bind().execute(
        sa.text(
            """
            INSERT INTO role_feature_defaults (role, feature_id, enabled)
            SELECT CAST(:role AS varchar), f.id, true
            FROM features f
            WHERE f.key = :key
              AND NOT EXISTS (
                    SELECT 1 FROM role_feature_defaults rfd
                    WHERE rfd.role = CAST(:role AS varchar)
                      AND rfd.feature_id = f.id
              )
            """
        ),
        {"role": _ROLE, "key": _FEATURE},
    )


def downgrade() -> None:
    # Only the default. A per-company override in `company_role_features` is
    # somebody's deliberate decision and is not this migration's to undo.
    op.get_bind().execute(
        sa.text(
            """
            DELETE FROM role_feature_defaults
            WHERE role = :role
              AND feature_id = (SELECT id FROM features WHERE key = :key)
            """
        ),
        {"role": _ROLE, "key": _FEATURE},
    )
