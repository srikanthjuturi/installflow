"""A point on the earth, and the distance between two of them.

Both halves live together for the same reason `core.phone` keeps `to_e164`
beside the `Phone` type: the pydantic bounds and the maths are one contract.
A latitude the schema accepted is a latitude `metres_between` can be handed.

Not `core.geo`. `app.features.geo` is the territory-master importer — regions,
states, districts, pincodes — and two imports three lines apart, one of them
about postal geography and the other about trigonometry, is a trap for no gain.

## What uses this

The proof check. A ticket whose address was picked off the map carries its own
coordinates, and the live site photo must have been taken within the company's
`geo_radius_m` of them. See `jobs.service._check_live_was_taken_at_the_job` for
the rule itself and for what happens to a ticket that has no point.
"""

import math
from typing import Annotated

from pydantic import Field

#: Metres. The IUGG mean radius — the sphere with the same surface area as the
#: WGS-84 ellipsoid, which is the right one to pick when the whole model is a
#: sphere anyway.
EARTH_RADIUS_M = 6_371_008.8

#: Anywhere on the planet. What a PHONE may report about itself: a device with
#: a confused fix should still be able to submit its proof and be judged on the
#: distance, rather than have the whole upload refused for a bad reading.
Latitude = Annotated[float | None, Field(default=None, ge=-90, le=90)]
Longitude = Annotated[float | None, Field(default=None, ge=-180, le=180)]

#: India, with a degree or so of margin — 6.75°N at Indira Point to 37.1°N in
#: the north, 68.1°E in Gujarat to 97.4°E in Arunachal Pradesh.
INDIA_LAT = (6.0, 38.0)
INDIA_LON = (68.0, 98.0)

#: Where a CUSTOMER's address may be, which is a different question.
#:
#: Every company, vendor and customer on this system is in India, so a ticket
#: outside this box is not a place — it is a bug in whatever produced it, and
#: the cost of storing one is silent: the proof check would then refuse every
#: technician who ever attends that job, with a message about a distance that
#: makes no sense to anybody reading it. Refusing at the boundary turns a
#: lockout nobody can diagnose into a 422 naming the field.
#:
#: `tickets` states the same box as a CHECK, because a migration, a script and
#: a psql session do not go through pydantic.
IndiaLatitude = Annotated[
    float | None, Field(default=None, ge=INDIA_LAT[0], le=INDIA_LAT[1])
]
IndiaLongitude = Annotated[
    float | None, Field(default=None, ge=INDIA_LON[0], le=INDIA_LON[1])
]


def metres_between(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two points, in metres.

    Haversine on a sphere, not a geodesic on the ellipsoid. The spherical
    approximation is wrong by at most about half a percent — five metres over
    the kilometre gate this exists to serve — which is an order of magnitude
    below the error the phone reports on its own fix. Buying more accuracy than
    the measurement carries would mean a dependency for nothing.

    Haversine rather than the school-book spherical law of cosines: the latter
    loses its precision at short distances, in `acos` of something very near 1,
    and short distances are the only ones this is ever asked about.
    """
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def metres_label(metres: float) -> str:
    """`"420 m"` below a kilometre, `"4.2 km"` above it.

    Whichever the technician standing there can act on. Shared so the refusal
    message and the ticket trail cannot round the same distance two ways.
    """
    return f"{metres / 1000:.1f} km" if metres >= 1000 else f"{round(metres)} m"
