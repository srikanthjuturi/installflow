"""Staff may import a vendor's tickets

One feature key, `jobs.import`, for the bulk ticket importer's staff route.

**Not `jobs.create`, and hard rule 2 is the whole reason**: "a key that already
exists is not automatically the right key."

`jobs.create` was deliberately REVOKED from admin, national_head, regional_head
and area_manager by `d5f61c07ab29` — the migration that made "only a vendor
raises a ticket" true in the defaults as well as in the router. The console also
reads that key to decide whether to draw a Raise-a-ticket screen. Re-granting it
so a manager could upload a spreadsheet would undo that decision and put a
manual intake screen back in every manager's rail as a side effect.

So the staff route carries its own key, and a company can grant bulk import
without granting single-ticket creation — which is the distinction the two
things actually have.

Seeded to **admin and national_head only**. The router additionally pairs it
with `require_min_rank(NATIONAL_HEAD)`, which no per-company override can lift,
for the reason `jobs.force_close` and `masters.approve` carry the same floor:
the act spends money, since 500 imported tickets is 500 credit charges. Regional
Head and Area Manager are left out on purpose — hard rule 3 says an Area Manager
may act only inside their own states, and a bulk file carries pincodes from
anywhere, so admitting one would mean a per-row territory refusal rather than a
rule that either applies or does not.

A vendor needs nothing here: its own import route is gated on `jobs.create`,
which the two portal roles already hold, because a vendor uploading its own
sheet is doing exactly what it does on the form.

Parented under `jobs.view` so it sits with the rest of the ticket surface on the
Feature Access screen.

Downgrade removes the per-company overrides and the role defaults before the
feature itself, in that order — `company_role_features` and
`role_feature_defaults` both point at it.

Revision ID: d3b70c5e1f94
Revises: c9a41f7b0e83
Create Date: 2026-09-28 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d3b70c5e1f94"
down_revision: Union[str, Sequence[str], None] = "c9a41f7b0e83"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (key, label, parent_key, sort_order)
FEATURES = [("jobs.import", "Import Tickets", "jobs.view", 22)]

DEFAULTS = {
    "admin": ["jobs.import"],
    "national_head": ["jobs.import"],
}


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "INSERT INTO features (key, label, parent_key, sort_order, is_active) "
            "VALUES (:k, :l, :p, :s, true)"
        ),
        [{"k": k, "l": lbl, "p": p, "s": s} for k, lbl, p, s in FEATURES],
    )
    conn.execute(
        sa.text(
            "INSERT INTO role_feature_defaults (role, feature_id, enabled) "
            "SELECT :role, f.id, true FROM features f WHERE f.key = :key"
        ),
        [
            {"role": role, "key": key}
            for role, keys in DEFAULTS.items()
            for key in keys
        ],
    )


def downgrade() -> None:
    conn = op.get_bind()
    keys = [k for k, _, _, _ in FEATURES]
    conn.execute(
        sa.text(
            "DELETE FROM role_feature_defaults WHERE feature_id IN "
            "(SELECT id FROM features WHERE key = ANY(:keys))"
        ),
        {"keys": keys},
    )
    conn.execute(
        sa.text(
            "DELETE FROM company_role_features WHERE feature_id IN "
            "(SELECT id FROM features WHERE key = ANY(:keys))"
        ),
        {"keys": keys},
    )
    conn.execute(
        sa.text("DELETE FROM features WHERE key = ANY(:keys)"), {"keys": keys}
    )
