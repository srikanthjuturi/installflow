"""A pincode knows where it is

Two nullable coordinate columns on the pincode master, plus the India-box CHECK
that `tickets` already carries. They give a coordinate to every job whose
address was TYPED rather than picked off the map — the Excel and API intake
channels have no browser to run Google Places in, so their tickets reach the
system with a pincode and nothing else. Travel-distance (base pincode -> job
pincode, via core.coordinates.metres_between) and the proof check's
pincode-branch fallback both read these.

## Nullable, and no backfill in THIS migration

NULL means "no coordinate loaded for this code yet". That is the correct answer
for all 19,496 rows the moment this runs: the migration adds the columns, the
DATA arrives separately through app.scripts.import_pincode_coordinates. A
server_default would be a fabricated position the proof check would then enforce
against a technician standing at the right door — the same reason tickets has no
backfill (see c2f70a5b81e4).

## Column type

Float (double precision), matching tickets.latitude / ticket_proofs.latitude,
because travel-distance compares a pincode point against those directly. Not
Numeric — a coordinate is a measurement that arrives with tens of metres of
error; the precision Numeric buys is smaller than the noise.

## No index

Nobody queries pincodes BY coordinate — the access pattern is always "given
this pincode code, what is its point", and `code` is the primary key. A btree
or spatial index on lat/lon would be dead weight until a "nearest pincode to a
point" query exists.

## Migrate both DBs before publishing

select(Pincode) loads the whole entity. The moment the model declares latitude
every pincode read asks for it. An API published against an unmigrated database
500s the Geography screen and every pincode picker. Apply to RelianceDB and
RelianceProdDB first; publish second.

Revision ID: f9c2d8a3e17b
Revises: ea2fb2654b95
Create Date: 2026-10-14 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f9c2d8a3e17b"
down_revision: Union[str, Sequence[str], None] = "ea2fb2654b95"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # No server_default and no backfill: see the docstring. NULL is the answer
    # for every row that exists today, and it is the correct one.
    op.add_column("pincodes", sa.Column("latitude", sa.Float(), nullable=True))
    op.add_column("pincodes", sa.Column("longitude", sa.Float(), nullable=True))

    # Half a point is not a place, and the box is India rather than the globe —
    # 0,0 is in the Gulf of Guinea, passes every naive range check, and would
    # then refuse every technician attending a job against it. Named after the
    # constraint, not prefixed — the naming convention on target_metadata expands
    # it to ck_pincodes_coordinates. Mirrors tickets.coordinates_both_or_neither
    # exactly so the two coordinate sets obey one rule.
    op.create_check_constraint(
        "coordinates",
        "pincodes",
        "(latitude IS NULL) = (longitude IS NULL) "
        "AND (latitude IS NULL OR (latitude BETWEEN 6 AND 38 "
        "AND longitude BETWEEN 68 AND 98))",
    )


def downgrade() -> None:
    # Use the short name — the naming convention on target_metadata expands it
    # to ck_pincodes_coordinates, matching what upgrade() created. Passing the
    # already-expanded name here would produce ck_pincodes_ck_pincodes_coordinates
    # and fail. Same pattern as c2f70a5b81e4's downgrade.
    op.drop_constraint("coordinates", "pincodes", type_="check")
    op.drop_column("pincodes", "longitude")
    op.drop_column("pincodes", "latitude")
