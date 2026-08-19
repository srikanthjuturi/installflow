"""A vendor is an account, and only a vendor raises a ticket.

Two roles join the six: `vendor` (rank 6) and `vendor_user` (rank 7). They are
APPENDED rather than slotted in, because `roles.rank` is UNIQUE and a vendor
genuinely belongs below everyone — rank answers "may I manage this person?", and
for a vendor the answer is no in both directions.

Two feature keys come with them:

  * `vendor.portal` — the portal surface itself, so the console has one key to
    ask about rather than inferring a shell from a role name;
  * `vendor.users` — a vendor managing its own sub-users. Deliberately NOT the
    existing `users.*` keys: those gate `/users`, which lists and edits the
    COMPANY's staff. A vendor holding `users.view` could read every manager in
    the tenant. The portal gets its own endpoints and its own key.

`masters.view` IS granted, because the intake form needs the product tree — and
`list_categories` pins `vendor_id` to the caller's own vendor, so the key cannot
be used to enumerate a competitor's catalogue.

And `jobs.create` is REVOKED from admin, national_head, regional_head and
area_manager. Raising a ticket becomes the vendor's job alone.

Safe against existing per-company overrides: `update_role_features` deletes an
override row when it equals the shipped default, and the default has been `true`
until now — so the only `company_role_features` rows that can exist for
`jobs.create` say `false`, and they keep saying it.

That revocation is a defaults change, which any company admin can undo through
Feature Access. The rule is enforced in code by `require_vendor_principal` on
`POST /tickets`; this migration is what stops the console offering a screen that
would 403.
"""

import sqlalchemy as sa
from alembic import op

revision = "d5f61c07ab29"
down_revision = "e2a740c1b358"
branch_labels = None
depends_on = None

ROLES = [("vendor", "Vendor", 6), ("vendor_user", "Vendor User", 7)]

# (key, label, parent_key, sort_order) — parent first, self-referencing FK.
FEATURES = [
    ("vendor.portal", "Vendor Portal", None, 95),
    ("vendor.users", "Vendor Users", "vendor.portal", 96),
]

DEFAULTS = {
    "vendor": [
        "vendor.portal",
        "vendor.users",
        "jobs.view",
        "jobs.create",
        "masters.view",
    ],
    # No `vendor.users`: a sub-user raises tickets, it does not create more
    # sub-users. One vendor, one place accounts come from.
    "vendor_user": ["vendor.portal", "jobs.view", "jobs.create", "masters.view"],
}

REVOKE_FROM = ["admin", "national_head", "regional_head", "area_manager"]


def upgrade() -> None:
    conn = op.get_bind()

    conn.execute(
        sa.text("INSERT INTO roles (key, label, rank) VALUES (:k, :l, :r)"),
        [{"k": k, "l": lbl, "r": r} for k, lbl, r in ROLES],
    )
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

    # Only a vendor raises a ticket now.
    conn.execute(
        sa.text(
            "DELETE FROM role_feature_defaults "
            "WHERE role = ANY(:roles) "
            "  AND feature_id = (SELECT id FROM features WHERE key = 'jobs.create')"
        ),
        {"roles": REVOKE_FROM},
    )


def downgrade() -> None:
    conn = op.get_bind()

    conn.execute(
        sa.text(
            "INSERT INTO role_feature_defaults (role, feature_id, enabled) "
            "SELECT unnest(CAST(:roles AS varchar[])), f.id, true "
            "FROM features f WHERE f.key = 'jobs.create'"
        ),
        {"roles": REVOKE_FROM},
    )

    # Order matters: the defaults reference the features, and `users.role` is an
    # FK to `roles.key` ON DELETE RESTRICT — so any account still holding one of
    # these roles will (correctly) refuse the downgrade rather than be orphaned.
    conn.execute(
        sa.text("DELETE FROM role_feature_defaults WHERE role = ANY(:roles)"),
        {"roles": [k for k, _, _ in ROLES]},
    )
    conn.execute(
        sa.text(
            "DELETE FROM company_role_features WHERE role = ANY(:roles)"
        ),
        {"roles": [k for k, _, _ in ROLES]},
    )
    conn.execute(
        sa.text(
            "DELETE FROM role_feature_defaults WHERE feature_id IN "
            "(SELECT id FROM features WHERE key = ANY(:keys))"
        ),
        {"keys": [k for k, _, _, _ in FEATURES]},
    )
    conn.execute(
        sa.text(
            "DELETE FROM company_role_features WHERE feature_id IN "
            "(SELECT id FROM features WHERE key = ANY(:keys))"
        ),
        {"keys": [k for k, _, _, _ in FEATURES]},
    )
    # Children before parents — `parent_key` is a self-FK.
    conn.execute(
        sa.text("DELETE FROM features WHERE key = ANY(:keys)"),
        {"keys": [k for k, _, _, _ in reversed(FEATURES)]},
    )
    conn.execute(
        sa.text("DELETE FROM roles WHERE key = ANY(:keys)"),
        {"keys": [k for k, _, _ in ROLES]},
    )
