"""What the portal's two picker endpoints send. No writes anywhere in the slice."""

import uuid

from app.core.facility_users import (  # noqa: F401  re-exported: the shapes of /franchise/facility-users
    FacilityUserCreateRequest,
    FacilityUserCreatedOut,
    FacilityUserOut,
    FacilityUserUpdateRequest,
)
from app.core.schemas import AppModel


class FranchiseRegionOut(AppModel):
    """A region that holds at least one of this franchisee's pincodes."""

    id: uuid.UUID
    name: str


class FranchiseSubcategoryOut(AppModel):
    """A main sub-category a technician can certify on (CERTIFY_DEPTH).

    `pathLabel` is the sub-category's name — a technician certifies on a main
    sub-category, so *Television* is the label the portal draws, and the root
    (*Electronics*) sits beside it as `rootName`.
    """

    id: uuid.UUID
    name: str
    rootId: uuid.UUID
    rootName: str
    pathLabel: str


class FranchiseOptionsOut(AppModel):
    """`GET /franchise/technician-options` — both pickers of the Add form."""

    regions: list[FranchiseRegionOut]
    subcategories: list[FranchiseSubcategoryOut]


class FranchisePincodeOut(AppModel):
    """A pincode inside this franchisee, with where it is.

    Rule 4 duplicates `features/geo`'s `PincodeOut` rather than a feature
    importing a feature. Same field names, same order, same meaning; a change
    to one is a change to the other, on purpose — `latitude`/`longitude` joined
    in Task 10 (§4.7): the console's *Use centre* moves its pin to the point a
    pincode base will be copied from, so it needs the point too.
    """

    code: str
    stateId: uuid.UUID
    stateName: str
    regionId: uuid.UUID
    regionName: str
    #: Usually one, but 1,209 real pincodes span up to four districts — and
    #: four belong to no district at all, so this list can also be empty.
    districts: list[str]
    #: The same districts by id, in the same order. Names are for reading and
    #: ids are for editing — five district names belong to two states each, so
    #: a name is not an identity and an edit form cannot round-trip one.
    districtIds: list[uuid.UUID]
    #: Always true here: the read filters to active codes only, mirroring
    #: `geo.list_pincodes`'s default (a picker shows what can be offered).
    isActive: bool
    #: 'import' | 'manual' — carried, not used; the portal never edits a row.
    source: str
    #: The pincode's representative point, the same figures `PincodeOut` — a
    #: pincode base copies them when a technician picks this code as their base.
    #: Null for the ~300 codes without a point.
    latitude: float | None = None
    longitude: float | None = None