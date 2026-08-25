"""Tenant-isolation audit. Run it after ANY schema change.

    python -m app.scripts.audit_tenancy

This product is multi-tenant: one company's data must never be reachable from,
or linkable to, another's. That rule is easy to state, easy to agree with, and
easy to forget on the third table of a busy afternoon — so it is checked here
rather than remembered.

Three things it looks for.

1. A tenant table with no `company_id`. Tenant tables are the ones holding
   business data; the exceptions are listed in GLOBAL_TABLES below, and adding
   to that list should take an argument.

2. A parent/child link inside a tenant table that is a plain single-column FK.
   Those permit a child in company A to point at a parent in company B — the
   database will happily store it, and only an application check stands in the
   way. The fix is the pattern `memberships.manager_id` already uses: a UNIQUE
   on the parent's (company_id, id), and a COMPOSITE FK on the child's
   (company_id, parent_id).

3. Rows that already violate their own tenancy — a child whose company_id does
   not match its parent's. Should be impossible once (2) holds; checked anyway,
   because "impossible" is what everyone said before the first one appeared.

Exit code is non-zero when anything is found, so this can gate CI.
"""

import asyncio
import sys
import warnings

if sys.platform == "win32":
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy import text  # noqa: E402

from app.core.database import AsyncSessionLocal  # noqa: E402

#: Tables that legitimately have no `company_id`, each with the reason.
GLOBAL_TABLES: dict[str, str] = {
    "alembic_version": "migration bookkeeping",
    "companies": "IS the tenant",
    "users": "a person may belong to several companies; the membership is the tenant link",
    "roles": "global role catalogue",
    "features": "global feature catalogue",
    "role_feature_defaults": "per-role defaults; company_role_features carries the override",
    "regions": "geography - the same five regions for every company",
    "states": "geography - the same India for every company",
    "districts": "geography - the same India for every company",
    "pincodes": "geography - the same India for every company",
    "pincode_districts": "geography - joins two global tables",
    "membership_regions": "scoped through membership_id, which is company-scoped",
    "refresh_tokens": "belongs to a user, not a company; the token's claim carries the company",
    "otp_codes": "issued before a company is selected - auth precedes tenancy",
}

#: (child, column, parent) links that must be composite.
TENANT_LINKS = [
    ("product_subcategories", "category_id", "product_categories"),
    ("product_models", "subcategory_id", "product_subcategories"),
    ("product_models", "vendor_id", "vendors"),
    ("technician_subcategories", "technician_id", "technician_profiles"),
    ("technician_subcategories", "subcategory_id", "product_subcategories"),
    ("technician_pincodes", "technician_id", "technician_profiles"),
    ("technician_invite_pincodes", "invite_id", "technician_invites"),
    ("technician_profiles", "membership_id", "memberships"),
    # An area manager's states. `membership_pincodes`, which this replaces,
    # had a plain FK here and so could name company A while pointing at a
    # membership in company B; the replacement does not.
    ("membership_states", "membership_id", "memberships"),
    ("tickets", "vendor_id", "vendors"),
    ("tickets", "subcategory_id", "product_subcategories"),
    ("tickets", "model_id", "product_models"),
    ("tickets", "technician_id", "technician_profiles"),
    ("ticket_events", "ticket_id", "tickets"),
    # Proof photographs — the inside of a customer's home. Of everything in
    # this list, the row that would hurt most to leak across a tenant boundary.
    ("ticket_proofs", "ticket_id", "tickets"),
    # A notification names a ticket in its title. One pointing across a tenant
    # boundary would put another company's ticket code in somebody's bell.
    ("notifications", "ticket_id", "tickets"),
    # A vendor's login. NB this proves the LINK is tenant-safe — a membership
    # cannot name another company's vendor. It says nothing about whether one
    # vendor can read another's tickets INSIDE a company; that is an application
    # invariant this script has no way to see. See api/AGENTS.md.
    ("memberships", "vendor_id", "vendors"),
]


async def audit() -> int:
    problems: list[str] = []

    async with AsyncSessionLocal() as s:
        print("-- tables without company_id " + "-" * 34)
        rows = await s.execute(
            text(
                """
                SELECT t.table_name
                FROM information_schema.tables t
                WHERE t.table_schema = 'public'
                  AND t.table_type = 'BASE TABLE'
                  AND NOT EXISTS (
                      SELECT 1 FROM information_schema.columns c
                      WHERE c.table_name = t.table_name
                        AND c.column_name = 'company_id'
                  )
                ORDER BY t.table_name
                """
            )
        )
        for (table,) in rows:
            reason = GLOBAL_TABLES.get(table)
            if reason:
                print(f"  ok      {table:26} global - {reason}")
            else:
                print(f"  PROBLEM {table:26} tenant data with no company_id")
                problems.append(f"{table} has no company_id and is not listed as global")

        print("\n-- parent links that must be composite ------------------------")
        for child, column, parent in TENANT_LINKS:
            composite = await s.scalar(
                text(
                    """
                    SELECT count(*) FROM pg_constraint
                    WHERE contype = 'f'
                      AND conrelid = CAST(:child AS regclass)
                      AND confrelid = CAST(:parent AS regclass)
                      AND array_length(conkey, 1) = 2
                    """
                ),
                {"child": child, "parent": parent},
            )
            if composite:
                print(f"  ok      {child}.{column} -> {parent}")
            else:
                print(f"  PROBLEM {child}.{column} -> {parent} is single-column")
                problems.append(
                    f"{child}.{column} -> {parent} must be a composite "
                    f"(company_id, {column}) foreign key"
                )

        print("\n-- rows whose company disagrees with their parent's -----------")
        for child, column, parent in TENANT_LINKS:
            has_company = await s.scalar(
                text(
                    """
                    SELECT count(*) FROM information_schema.columns
                    WHERE table_name = CAST(:t AS name) AND column_name = 'company_id'
                    """
                ),
                {"t": child},
            )
            if not has_company:
                continue
            mismatched = await s.scalar(
                text(
                    f"""
                    SELECT count(*) FROM {child} c
                    JOIN {parent} p ON p.id = c.{column}
                    WHERE p.company_id IS DISTINCT FROM c.company_id
                    """
                )
            )
            if mismatched:
                print(f"  PROBLEM {child}: {mismatched} row(s) point at another company")
                problems.append(f"{child} has {mismatched} cross-company row(s)")
            else:
                print(f"  ok      {child} -> {parent}")

    print()
    if problems:
        print(f"{len(problems)} problem(s):")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("Tenant isolation intact.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(audit()))
