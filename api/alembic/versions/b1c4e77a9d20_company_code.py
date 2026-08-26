"""companies.code — the tenant prefix on every human-facing code

Revision ID: b1c4e77a9d20
Revises: 494d63571f2f
Create Date: 2026-08-26

`RGT-INST-0001`. The counter behind it is per-company, so without this token
every tenant mints its own `INST-0001` and a code alone cannot identify a row in
anything spanning more than one company.

Added NOT NULL in three steps rather than one, because existing companies have
no code and a bare NOT NULL would fail on any non-empty table: add nullable,
backfill from the name with the same rule the application uses, then tighten.

The UNIQUE is partial on `deleted_at IS NULL`, matching every other unique in
this schema — otherwise a soft-deleted company keeps its code reserved forever
and re-creating it fails with nothing on screen to explain why.
"""

from alembic import op
import sqlalchemy as sa

revision = "b1c4e77a9d20"
down_revision = "494d63571f2f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("companies", sa.Column("code", sa.String(length=6), nullable=True))

    # Backfill with the application's own rule so existing rows get the code they
    # would have been given, rather than a placeholder somebody has to clean up.
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, name FROM companies ORDER BY created_at")).all()
    if rows:
        from app.core.company_code import MAX_LEN, derive

        used: set[str] = set()
        for row in rows:
            base = derive(row.name or "")
            candidate, n = base, 2
            while candidate.lower() in used:
                suffix = str(n)
                candidate = f"{base[: MAX_LEN - len(suffix)]}{suffix}"
                n += 1
            used.add(candidate.lower())
            conn.execute(
                sa.text("UPDATE companies SET code = :code WHERE id = :id"),
                {"code": candidate, "id": row.id},
            )

    op.alter_column("companies", "code", nullable=False)
    op.execute(
        "CREATE UNIQUE INDEX uq_companies_code_lower "
        "ON companies (lower(code)) WHERE deleted_at IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_companies_code_lower")
    op.drop_column("companies", "code")
