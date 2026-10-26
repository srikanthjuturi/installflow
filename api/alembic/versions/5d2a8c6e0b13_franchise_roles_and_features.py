"""Franchise roles join the catalogue, and the feature keys their screens ask for.

Three roles append BELOW everyone: `franchisee_admin` (8), `facility_admin` (9),
`facility_operator` (10). Appended, not slotted, because `roles.rank` is UNIQUE —
and appending is the whole point: every existing `require_min_rank(...)` floor on
a staff-only screen (credits, settings, vendors, vendor credit, redemption pay,
force close, reschedule …) refuses a franchise role automatically, because its
rank sits above the floor. Fails closed, which is what those screens want until
Tasks 04/05 open the franchise doors deliberately.

What rank must NEVER do is decide franchise authority over technicians and money.
Authority there is per franchisee — a relationship between two rows — while rank
is a property of one role. Renumbering would not help: put the franchise roles
above technician and SkyFix's admin would "outrank" every technician in the
company, home and other franchisees' included, and an Area Manager (4) would
"outrank" every franchisee admin. The Users screen's `ensure_below_rank` is left
untouched for the same reason it already refuses a vendor by name — an Area
Manager "outranks" rank 8 — and `create_user` gains its own explicit refusal
(Task 02 §4.6). Authority is decided in `core.franchise_scope` by franchisee
equality, wired in by Task 05; nothing here grants it.

Eleven feature keys (§3.4). They are SEPARATE from the staff keys they resemble
(`technicians.*`, `redemptions.pay`) on purpose: F8 keeps home-franchisee money
and technician screens on the existing keys for existing roles, and a franchisee
admin holding `technicians.view` would otherwise inherit a staff screen's whole
semantics rather than the portal's. Defaults per role come straight from index
§3.4 — `franchisees.manage` is the only key with a parent (`franchisees.view`);
the rest stay top-level so the Feature Access tree implies no coupling that does
not exist. Owner ruling 2026-10-15 (R4): `parts.handle` is NEVER seeded to a
staff role, home included — Admin/NH manage the home franchisee's facility users
through `franchisees.manage` instead.

Reference data only, inserted idempotently (`WHERE NOT EXISTS`, so re-running a
partial apply on dev cannot duplicate a row and renumbering nothing). The tables
are already classified (`roles`, `features`, `role_feature_defaults` are in
`GLOBAL_TABLES`; `company_role_features` is tenant data already linked), so no
`audit_tenancy` change follows.

Downgrade refuses IN WORDS first: `users.role` is a RESTRICT FK to `roles.key`,
so Postgres would refuse anyway — but the error Postgres raises does not say
"you have three franchisee admins still active in this company", and the person
downgrading needs to hear that. Deletes children features before parents
(`parent_key` is a self-FK).
"""

import sqlalchemy as sa
from alembic import op

revision = "5d2a8c6e0b13"
down_revision = "3b7e1f0a9c41"
branch_labels = None
depends_on = None

ROLES = [
    ("franchisee_admin", "Franchisee Admin", 8),
    ("facility_admin", "Facility Admin", 9),
    ("facility_operator", "Facility Operator", 10),
]

# (key, label, parent_key, sort_order) — parents first (self-FK on parent_key).
FEATURES = [
    ("franchisees.view", "Franchisees", None, 64),
    ("franchisees.manage", "Manage Franchisees", "franchisees.view", 65),
    ("parts.catalogue", "Spare Parts Catalogue", None, 88),
    ("franchise.technicians", "Franchise Technicians", None, 100),
    ("franchise.payouts", "Franchise Payouts", None, 101),
    ("franchise.pool", "Franchise Penalty Pool", None, 102),
    ("franchise.settings", "Travel & Speed Settings", None, 103),
    ("franchise.statements", "Employee Statements", None, 104),
    ("franchise.tickets", "Franchise Tickets", None, 105),
    ("franchise.facility_users", "Facility Users", None, 106),
    ("parts.handle", "Handle Part Requests", None, 107),
]

# Exactly index §3.4 — the task file prints this table and the unit test holds
# its own literal copy, so a silent edit here fails twice.
DEFAULTS = {
    "franchisees.manage": ["admin", "national_head"],
    "franchisees.view": ["admin", "national_head", "regional_head", "area_manager"],
    "franchise.technicians": ["franchisee_admin"],
    "franchise.payouts": ["franchisee_admin"],
    "franchise.pool": ["franchisee_admin"],
    "franchise.settings": ["franchisee_admin"],
    "franchise.statements": ["franchisee_admin"],
    "franchise.tickets": ["franchisee_admin", "facility_admin", "facility_operator"],
    "franchise.facility_users": ["franchisee_admin", "facility_admin"],
    "parts.handle": ["franchisee_admin", "facility_admin", "facility_operator"],
    "parts.catalogue": ["admin", "national_head"],
    # Owner ruling 2026-10-15 (R4): `parts.handle` is NEVER seeded to a staff role (no Admin/NH parts fallback, home
    # included). Admin/NH create the HOME franchisee's facility users through the existing `franchisees.manage`
    # — no extra key is seeded here (Task 12 §4.8b).
}


def upgrade() -> None:
    bind = op.get_bind()
    for key, label, rank in ROLES:
        bind.execute(sa.text(
            "INSERT INTO roles (key, label, rank) SELECT CAST(:k AS varchar), CAST(:l AS varchar), "
            "CAST(:r AS integer) WHERE NOT EXISTS (SELECT 1 FROM roles WHERE key = :k)"),
            {"k": key, "l": label, "r": rank})
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


def downgrade_blockers(holders: int) -> list[str]:
    """PURE. Unit-tested."""
    return [f"{holders} user(s) hold a franchise role"] if holders else []


def downgrade() -> None:
    bind = op.get_bind()
    role_keys = [k for k, _, _ in ROLES]
    feature_keys = [k for k, _, _, _ in FEATURES]
    holders = bind.scalar(sa.text("SELECT count(*) FROM users WHERE role = ANY(:r)"), {"r": role_keys})
    blockers = downgrade_blockers(holders)
    if blockers:  # users.role -> roles.key is RESTRICT anyway; say why in words first
        raise RuntimeError("Refusing to downgrade 5d2a8c6e0b13: " + "; ".join(blockers)
                           + ". Remove those logins first.")
    for table in ("company_role_features", "role_feature_defaults"):
        bind.execute(sa.text(f"DELETE FROM {table} WHERE role = ANY(:r)"), {"r": role_keys})
        bind.execute(sa.text(f"DELETE FROM {table} WHERE feature_id IN "
                             "(SELECT id FROM features WHERE key = ANY(:k))"), {"k": feature_keys})
    # Children before parents — parent_key is a self-FK.
    bind.execute(sa.text("DELETE FROM features WHERE key = ANY(:k) AND parent_key IS NOT NULL"),
                 {"k": feature_keys})
    bind.execute(sa.text("DELETE FROM features WHERE key = ANY(:k)"), {"k": feature_keys})
    bind.execute(sa.text("DELETE FROM roles WHERE key = ANY(:r)"), {"r": role_keys})