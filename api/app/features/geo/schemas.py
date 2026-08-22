"""Wire shapes for the geography master and its importer."""

import uuid

from pydantic import Field

from app.core.schemas import AppModel


class RegionOut(AppModel):
    """A region, with how much of the master sits under it.

    Deliberately not the rbac slice's `/regions`: that one is guarded by
    `CompanyPrincipal`, which refuses a superadmin outright — so the console
    screen that MAINTAINS this data could not read it. Same rows, a guard that
    fits the caller, plus the counts this screen needs.
    """

    id: uuid.UUID
    code: str
    name: str
    isActive: bool
    stateCount: int
    #: Both counted down the whole tree, so a region tile can show real figures
    #: without the client summing 36 state rows.
    districtCount: int
    pincodeCount: int


class StateOut(AppModel):
    id: uuid.UUID
    name: str
    regionId: uuid.UUID
    regionName: str
    isActive: bool
    districtCount: int
    pincodeCount: int


class DistrictOut(AppModel):
    """A district and how many pincodes touch it.

    `pincodeCount` is counted through `pincode_districts`, so the counts of a
    state's districts SUM TO MORE than the state's pincode count — 1,209
    pincodes span two to four districts and are counted in each. Never present
    that sum as a total; `StateOut.pincodeCount` is the honest figure.
    """

    id: uuid.UUID
    name: str
    stateId: uuid.UUID
    stateName: str
    regionId: uuid.UUID
    regionName: str
    pincodeCount: int


class PincodeOut(AppModel):
    code: str
    stateId: uuid.UUID
    stateName: str
    regionId: uuid.UUID
    regionName: str
    #: Usually one, but 1,209 real pincodes span up to four districts — and four
    #: belong to no district at all, so this list can also be empty.
    districts: list[str] = Field(default_factory=list)


class ImportCounts(AppModel):
    created: int = 0
    updated: int = 0
    #: A row that re-parents an existing record — a pincode changing state, or a
    #: state changing region. Never silent: somebody's territory moves with it.
    moved: int = 0


class ImportReject(AppModel):
    row: int | None = None
    pincode: str | None = None
    reason: str


class ImportOverride(AppModel):
    pincode: str
    state: str
    reason: str
    #: "applied" when the file disagreed and was corrected, "agreed" when the
    #: file already had it right and the override changed nothing.
    outcome: str


class ImportReport(AppModel):
    dryRun: bool
    rowsRead: int
    #: Rows dropped before validation — the `#N/A` lookup failures.
    rowsSkipped: int
    regions: ImportCounts
    states: ImportCounts
    districts: ImportCounts
    pincodes: ImportCounts
    #: Regions that exist but end up with no states — a regional head assigned
    #: to one would cover nothing, so it is worth saying out loud.
    unusedRegions: list[str] = Field(default_factory=list)
    overrides: list[ImportOverride] = Field(default_factory=list)
    rejected: int = 0
    #: Capped; `rejected` carries the true total.
    rejects: list[ImportReject] = Field(default_factory=list)
