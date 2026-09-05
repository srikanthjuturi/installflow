"""A bell when a technician accepts

`accept` told nobody. That was defensible while a job could only be taken AFTER
the customer had agreed a time: the customer knew a visit was coming, and
`sweep_customer_notice` named the technician an hour before the slot.

Neither holds now that the pool carries jobs with no time agreed. There may be
no slot for that sweep to fire ahead of, and the vendor has been sitting on a
ticket with nothing to show for it since they raised it.

So `assigned` joins the nine kinds. One `CHECK` widened, nothing else — the
column, the index and the composite foreign keys are all unchanged.

## Why the constraint is dropped and recreated rather than altered

Postgres has no `ALTER ... MODIFY CHECK`. The pair below is the whole operation
and it is transactional, so a failure leaves the old constraint standing rather
than a table with none.

⚠ The name passed to BOTH calls is the bare `kind`, not `ck_notifications_kind`.
`NAMING_CONVENTION` in `db/base_class.py` interpolates a CHECK's given name into
`ck_%(table_name)s_%(constraint_name)s`, and it does so on the way OUT as well
as on the way in — passing the full name here would go looking for
`ck_notifications_ck_notifications_kind` and fail on a constraint that is
plainly there.

## The downgrade can fail, and should

Narrowing the list again is only safe if no row uses the kind being removed.
Rather than delete somebody's notifications to make a schema fit, the downgrade
refuses and names the count — the same shape `f4b28d1a67c3` used for a NOT NULL
with no honest default. Clear them deliberately, then run it.
"""

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "d3f81c605a29"
down_revision: Union[str, Sequence[str], None] = "b8d41e07c592"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

WITHOUT = (
    "kind IN ('escalation', 'ai', 'serial_mismatch', 'force_close', "
    "'slot', 'technician_joined', 'job_started', 'invite_expired', "
    "'no_show')"
)
WITH_ASSIGNED = (
    "kind IN ('escalation', 'ai', 'serial_mismatch', 'force_close', "
    "'slot', 'technician_joined', 'job_started', 'invite_expired', "
    "'assigned', 'no_show')"
)


def upgrade() -> None:
    op.drop_constraint("kind", "notifications", type_="check")
    op.create_check_constraint("kind", "notifications", WITH_ASSIGNED)


def downgrade() -> None:
    left = (
        op.get_bind()
        .execute(sa.text("SELECT count(*) FROM notifications WHERE kind = 'assigned'"))
        .scalar()
    )
    if left:
        raise RuntimeError(
            f"{left} notification(s) have kind 'assigned'. Narrowing the CHECK "
            "would leave rows the constraint forbids. Delete or re-kind them "
            "first — this migration will not throw away somebody's feed to make "
            "a schema fit."
        )
    op.drop_constraint("kind", "notifications", type_="check")
    op.create_check_constraint("kind", "notifications", WITHOUT)
