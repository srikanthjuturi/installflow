"""Territory view: region → regional heads → area managers → states."""

import uuid

from app.core.schemas import AppModel


class TerritoryPerson(AppModel):
    membershipId: uuid.UUID
    name: str
    #: Defensively nullable. Only RH/AM rows reach this schema and both always
    #: have an email, but `users.email` is nullable now and a 500 here would be
    #: a whole screen lost to one bad row.
    email: str | None
    isActive: bool


class TerritoryAreaManager(TerritoryPerson):
    #: The states this manager covers. He covers every pincode inside them, but
    #: that is derived from the master and far too long to list here.
    states: list[str]


class TerritoryRegion(AppModel):
    id: uuid.UUID
    code: str
    name: str
    regionalHeads: list[TerritoryPerson]
    areaManagers: list[TerritoryAreaManager]
    #: States in this region that no area manager covers yet — the gap somebody
    #: has to fill, which is more useful than a total nobody can act on.
    unassignedStates: list[str]
    stateCount: int
