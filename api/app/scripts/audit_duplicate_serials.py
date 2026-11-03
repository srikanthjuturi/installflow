"""Find serials that company-wide uniqueness would newly forbid.

    python -m app.scripts.audit_duplicate_serials

`product_model_serials` is moving from per-(company, product_model) uniqueness
to per-company uniqueness — see the `..._serials_unique_company_wide` migration.
Before that migration runs, any (company, serial) pair that currently sits on
MORE THAN ONE distinct product model is a row the new UNIQUE index will refuse
to build against: `CREATE UNIQUE INDEX` fails outright the moment it finds a
duplicate, so these have to be found and cleaned by hand first.

This is READ-ONLY. It writes nothing, so it needs no `--apply` flag and no
`CONFIRM_PROD` gate — but it still reads whichever database `app.core.database`
is pointed at (the development one unless overridden, see `api/AGENTS.md`), and
production has to be checked the same way before its migration runs.

Exits 0 regardless of what it finds — it is a report for a human to act on, not
a gate.
"""

import asyncio
import selectors
import sys

from sqlalchemy import func, select

from app.core.database import AsyncSessionLocal
from app.models.product import ProductModel, ProductModelSerial


async def run() -> int:
    async with AsyncSessionLocal() as db:
        lower_serial = func.lower(ProductModelSerial.serial)
        model_count = func.count(func.distinct(ProductModelSerial.product_model_id))

        offenders = (
            await db.execute(
                select(
                    ProductModelSerial.company_id,
                    lower_serial.label("serial_lower"),
                    model_count.label("model_count"),
                )
                .group_by(ProductModelSerial.company_id, lower_serial)
                .having(model_count > 1)
                .order_by(ProductModelSerial.company_id, lower_serial)
            )
        ).all()

        if not offenders:
            print(
                "No serial sits on more than one product model within its "
                "company. Company-wide uniqueness is safe to apply."
            )
            return 0

        print(
            f"{len(offenders)} serial(s) sit on more than one product model "
            "within their company -- these block the new UNIQUE index:\n"
        )
        for company_id, serial_lower, count in offenders:
            models = (
                await db.execute(
                    select(ProductModelSerial.product_model_id, ProductModel.name)
                    .join(
                        ProductModel,
                        ProductModel.id == ProductModelSerial.product_model_id,
                    )
                    .where(
                        ProductModelSerial.company_id == company_id,
                        func.lower(ProductModelSerial.serial) == serial_lower,
                    )
                    .distinct()
                    .order_by(ProductModel.name)
                )
            ).all()
            described = ", ".join(
                f"{name!r} ({model_id})" for model_id, name in models
            )
            print(
                f"  company {company_id}  serial {serial_lower!r}  "
                f"on {count} models: {described}"
            )

        print(
            f"\n{len(offenders)} serial(s) would violate company-wide "
            "uniqueness. Clean these up (retype, remove, or merge the "
            "duplicate) before running the migration."
        )
    return 0


def main() -> int:
    return asyncio.run(
        run(),
        loop_factory=lambda: asyncio.SelectorEventLoop(selectors.SelectSelector()),
    )


if __name__ == "__main__":
    sys.exit(main())
