"""Free a soft-deleted row's name for reuse, and index every foreign key.

Two unrelated-looking fixes that are both about the gap between what the schema
meant and what it said.

1. THREE UNIQUE INDEXES IGNORED `deleted_at`.

   The initial migration introduces them under a comment reading "PARTIAL on
   `deleted_at IS NULL` so removing a row frees its name for reuse rather than
   poisoning it" — and then creates three of them without the WHERE clause. The
   product master got it right; users, companies and memberships did not.

   The consequence was live, not theoretical. Removing a technician soft-deletes
   their membership (`technicians/service.py` sets `deleted_at`), so re-adding
   that same person to that same company hit a 409 forever — and the row causing
   it is hidden from every screen, so nothing in the UI could explain the
   refusal. Deleting a console user burned that email address permanently the
   same way.

   `uq_memberships_user_company` was a UniqueConstraint rather than a raw index,
   so it is dropped and re-created as a partial index under the same name. It
   therefore leaves the model, like the other partial indexes already have.

   `uq_tickets_company_code` is deliberately NOT changed. A ticket number must
   never be reused: it is quoted in email and read out on the phone, and a
   deleted ticket sharing an identifier with a live one is worse than a blocked
   insert. The same argument does not apply to a person's email address.

   `uq_*_company_id_id` are also left alone, and must be — a partial index
   cannot be the target of a foreign key, and those are what every composite
   tenancy FK points at.

2. TWENTY-SIX FOREIGN KEYS HAD NO COVERING INDEX.

   Postgres does not index the referencing side of a foreign key for you. Two
   costs follow: a lookup by the child ("tickets for this vendor") scans, and —
   less obviously — so does every delete of a PARENT row, because the database
   must prove no child still points at it. `tickets(company_id, vendor_id)` was
   unindexed, so deleting one vendor read every ticket in the database.

   Harmless at today's volumes and expensive to retrofit later, which is the
   argument for doing it now while each CREATE INDEX takes milliseconds.

   Every FK is covered, including the ones on fixed platform catalogues where
   the index buys nothing measurable, so that the rule has no list of
   exceptions to maintain.
"""

from alembic import op

revision = "4c8f1b7d2e93"
down_revision = "9237a7143f8b"
branch_labels = None
depends_on = None


#: (name, table, columns) — one per foreign key that had no covering index.
#: Composite entries match a composite FK column-for-column and in order; a
#: prefix index on `company_id` alone does not serve the check.
FK_INDEXES = [
    ("ix_audit_logs_actor_user_id", "audit_logs", "actor_user_id"),
    ("ix_company_role_features_feature_id", "company_role_features", "feature_id"),
    ("ix_company_role_features_role", "company_role_features", "role"),
    ("ix_features_parent_key", "features", "parent_key"),
    ("ix_memberships_company_manager", "memberships", "company_id, manager_id"),
    ("ix_otp_codes_invite_id", "otp_codes", "invite_id"),
    ("ix_otp_codes_user_id", "otp_codes", "user_id"),
    ("ix_product_models_company_subcategory", "product_models", "company_id, subcategory_id"),
    ("ix_product_models_company_vendor", "product_models", "company_id, vendor_id"),
    ("ix_product_subcategories_company_category", "product_subcategories", "company_id, category_id"),
    ("ix_role_feature_defaults_feature_id", "role_feature_defaults", "feature_id"),
    ("ix_technician_invites_invited_by", "technician_invites", "invited_by_membership_id"),
    ("ix_technician_invites_manager", "technician_invites", "manager_membership_id"),
    ("ix_technician_invites_registered_membership", "technician_invites", "registered_membership_id"),
    ("ix_technician_invites_registered_user", "technician_invites", "registered_user_id"),
    ("ix_technician_pincodes_company_technician", "technician_pincodes", "company_id, technician_id"),
    ("ix_technician_profiles_appointed_by_membership", "technician_profiles", "appointed_by_membership_id"),
    ("ix_technician_profiles_company_membership", "technician_profiles", "company_id, membership_id"),
    ("ix_technician_profiles_invite_id", "technician_profiles", "invite_id"),
    ("ix_technician_subcategories_company_subcategory", "technician_subcategories", "company_id, subcategory_id"),
    ("ix_technician_subcategories_company_technician", "technician_subcategories", "company_id, technician_id"),
    ("ix_tickets_company_model", "tickets", "company_id, model_id"),
    ("ix_tickets_company_subcategory", "tickets", "company_id, subcategory_id"),
    ("ix_tickets_company_technician", "tickets", "company_id, technician_id"),
    ("ix_tickets_company_vendor", "tickets", "company_id, vendor_id"),
    ("ix_users_last_active_company", "users", "last_active_company_id"),
]


def upgrade() -> None:
    # -- 1. the three uniques that forgot `deleted_at` --------------------
    #
    # Raw DDL both ways: two are functional (`lower(...)`) and all three are
    # partial, and `Index()` can express neither.
    op.execute("DROP INDEX uq_companies_slug_lower")
    op.execute(
        "CREATE UNIQUE INDEX uq_companies_slug_lower "
        "ON companies (lower(slug)) WHERE deleted_at IS NULL"
    )
    op.execute("DROP INDEX uq_companies_gst_lower")
    op.execute(
        "CREATE UNIQUE INDEX uq_companies_gst_lower "
        "ON companies (lower(gst_number)) WHERE deleted_at IS NULL"
    )
    op.execute("DROP INDEX uq_users_email_lower")
    op.execute(
        "CREATE UNIQUE INDEX uq_users_email_lower "
        "ON users (lower(email)) WHERE deleted_at IS NULL"
    )

    # A constraint, not a bare index, so it needs dropping as one. The
    # replacement keeps the name: it means the same thing, only truthfully.
    op.drop_constraint("uq_memberships_user_company", "memberships", type_="unique")
    op.execute(
        "CREATE UNIQUE INDEX uq_memberships_user_company "
        "ON memberships (user_id, company_id) WHERE deleted_at IS NULL"
    )

    # -- 2. a covering index per foreign key ------------------------------
    for name, table, cols in FK_INDEXES:
        op.execute(f"CREATE INDEX {name} ON {table} ({cols})")


def downgrade() -> None:
    for name, _table, _cols in reversed(FK_INDEXES):
        op.execute(f"DROP INDEX {name}")

    # Back to a total unique. This can FAIL, and that is correct: if a
    # soft-deleted membership now shares (user_id, company_id) with a live one,
    # the old constraint genuinely cannot be re-created, and silently dropping
    # rows to force it would be worse than stopping.
    op.execute("DROP INDEX uq_memberships_user_company")
    op.create_unique_constraint(
        "uq_memberships_user_company", "memberships", ["user_id", "company_id"]
    )

    op.execute("DROP INDEX uq_users_email_lower")
    op.execute("CREATE UNIQUE INDEX uq_users_email_lower ON users (lower(email))")
    op.execute("DROP INDEX uq_companies_gst_lower")
    op.execute(
        "CREATE UNIQUE INDEX uq_companies_gst_lower ON companies (lower(gst_number))"
    )
    op.execute("DROP INDEX uq_companies_slug_lower")
    op.execute(
        "CREATE UNIQUE INDEX uq_companies_slug_lower ON companies (lower(slug))"
    )
