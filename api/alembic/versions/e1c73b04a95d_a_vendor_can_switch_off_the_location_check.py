"""A vendor can switch off the live-photo location check

`jobs.service._check_live_was_taken_at_the_job` has always been unconditional:
a live proof photo with no coordinates is refused, one taken outside
`geo_radius_m` of a ticket that knows where it is is refused, and one whose
device pincode disagrees with a ticket that does not is refused. The radius was
tunable per company and per catalogue node; the CHECK itself was not tunable at
all.

## Why a switch, and why it defaults ON

Some sites cannot produce a fix. A basement plant room, a steel-clad warehouse,
a rural dead spot — the phone reports nothing, the shutter never unblocks, and
the technician's only exit from a job they are standing at is a cancellation
penalty for a GPS problem. That is the case this exists for, and it is a
property of who raises the work rather than of the company or the product, which
is why it lands on `vendors` beside `address_search_enabled` rather than in
`company_rules` beside the radius it governs.

It defaults TRUE so nothing changes for a vendor nobody touches, and there is
**no backfill**: `ADD COLUMN ... NOT NULL DEFAULT true` fills every existing row
in the same statement, so today's vendors keep today's behaviour and new ones
inherit the same answer from one declaration.

## It is not the same question as `address_search_enabled`

Its neighbour decides WHICH rule applies — coordinates reach a ticket only from
a picked search result, so an off vendor's jobs fall back to comparing pincodes.
This one decides WHETHER either rule is enforced. Two columns because two
questions; a vendor may reasonably want the distance rule and no gate, or a gate
and no map.

## Off does not mean blind

Nothing here stops a location being recorded. The phone still asks for a fix,
still attaches it to the live shot, and `ticket_proofs` still stores the
latitude, longitude, accuracy and device pincode. The server still MEASURES the
distance when both ends have a point and still writes it to the ticket's
`started` event. What changes is that it never raises. A far-away photo becomes
a fact on a permanent record instead of a refusal, which is the outcome a
manager can actually act on.

## It is read live, and that is the one deliberate inconsistency

Every other term of a job is frozen at intake — both prices, and the whole
`rules_snapshot` — precisely so a later edit cannot restate work somebody
already accepted. This is not, and it is a considered exception: the switch has
to be usable while a technician is standing on the site, which a value stamped
at intake could never be. The cost is that flipping it changes jobs already in
flight, in both directions.

## Downgrade loses only the switch

The column is dropped; every vendor returns to being location-gated, which is
the behaviour of every revision before this one. Nothing else depends on it, so
there is no data to preserve.

Revision ID: e1c73b04a95d
Revises: d3f81c605a29
Create Date: 2026-09-05

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e1c73b04a95d"
down_revision: Union[str, Sequence[str], None] = "d3f81c605a29"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "vendors",
        sa.Column(
            "location_check_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )


def downgrade() -> None:
    op.drop_column("vendors", "location_check_enabled")
