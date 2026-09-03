"""A ticket knows where it is

The live site photo is the artifact that claims the technician attended, and
until now it was verified by comparing two POSTAL CODES: the one the phone
reverse-geocoded from its fix, against the one typed on the ticket. A pincode
covers several square kilometres, so that check passes from the wrong street,
and `_check_live_was_taken_at_the_job` said so in its own docstring — nothing
in this database mapped a coordinate to a pincode, so the server could not
verify even the label the phone attached.

The coordinates were already being fetched and thrown away. The vendor's ticket
form resolves the address the user picks through Google Places, and that call
returns the point alongside the components it was already asking for. Keeping
it turns the proof check into a distance.

  * `tickets.latitude` / `.longitude` — where the address is, when somebody
    picked it off the map.
  * `company_rules.geo_radius_m` — how far from that point the live photo may
    be taken. A kilometre, because the point is a geocoded plot centroid rather
    than the door.

## Nullable, and it stays nullable

There is no backfill and there must never be one. Null means "this address was
typed, not picked" — true of every ticket that exists today, and true of
everything the Excel and API intake channels will raise, neither of which has a
browser to run Places in. Those tickets keep the pincode rule exactly as it is
now. A backfill would have to invent a position, and an invented position is
one the server would then enforce against a technician standing at the right
door.

Both halves land in one revision because the check reads both, and a column
that arrives a deploy ahead of the rule that consults it is a column nobody can
tell is working.

## Migrate before publishing, and this one is not optional

Both slices load tickets with whole-entity `select(Ticket)`, so the moment the
model declares `latitude` every ticket read in the product asks for it. An API
published against an unmigrated database does not degrade the geo check — it
500s the ticket list, the pool, My jobs and the console.

Revision ID: c2f70a5b81e4
Revises: b4e17c92a08d
Create Date: 2026-09-03 14:05:12.884210

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c2f70a5b81e4"
down_revision: Union[str, Sequence[str], None] = "b4e17c92a08d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # No server_default and no backfill: see the docstring. NULL is the answer
    # for every row that exists, and it is the correct one.
    op.add_column("tickets", sa.Column("latitude", sa.Float(), nullable=True))
    op.add_column("tickets", sa.Column("longitude", sa.Float(), nullable=True))
    # Half a point is not a place, and the box is India rather than the globe —
    # 0,0 is in the Gulf of Guinea, passes every range check ever written, and
    # would refuse every technician who attended that job. See the column's
    # note and `core.coordinates.IndiaLatitude`, which states the same numbers
    # to pydantic. Named after the constraint, not prefixed — the naming
    # convention on `target_metadata` expands it.
    op.create_check_constraint(
        "coordinates_both_or_neither",
        "tickets",
        "(latitude IS NULL) = (longitude IS NULL) "
        "AND (latitude IS NULL OR (latitude BETWEEN 6 AND 38 "
        "AND longitude BETWEEN 68 AND 98))",
    )

    # `server_default` is what backfills the existing rows — the column is NOT
    # NULL and every company already has a rules row. It stays on the column
    # afterwards, like every other rule here, so a hand-written INSERT during a
    # restore does not have to know all thirteen numbers.
    op.add_column(
        "company_rules",
        sa.Column(
            "geo_radius_m",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1000"),
        ),
    )
    # The same bound the request schema and `core.rules.LIMITS` state. Three
    # declarations, one source, because each catches a different writer — this
    # one catches psql, a script, and a later migration.
    op.create_check_constraint(
        "geo_radius_m",
        "company_rules",
        "geo_radius_m >= 50 AND geo_radius_m <= 5000",
    )


def downgrade() -> None:
    op.drop_constraint("geo_radius_m", "company_rules", type_="check")
    op.drop_column("company_rules", "geo_radius_m")
    op.drop_constraint("coordinates_both_or_neither", "tickets", type_="check")
    op.drop_column("tickets", "longitude")
    op.drop_column("tickets", "latitude")
