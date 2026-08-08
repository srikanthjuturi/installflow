"""Territory view: region → regional heads → area managers → pincodes."""

import uuid

from app.core.schemas import AppModel


class TerritoryPerson(AppModel):
    membershipId: uuid.UUID
    name: str
    email: str
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
