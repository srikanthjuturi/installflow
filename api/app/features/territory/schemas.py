"""Territory view: region → regional heads → area managers → pincodes."""

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
    pincodes: list[str]


class TerritoryRegion(AppModel):
    id: uuid.UUID
    code: str
    name: str
    regionalHeads: list[TerritoryPerson]
    areaManagers: list[TerritoryAreaManager]
    pincodeCount: int
