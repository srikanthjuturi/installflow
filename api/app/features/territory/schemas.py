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


class TerritoryState(AppModel):
    """One state, and who covers it.

    The map needs this and `unassignedStates` cannot give it: that is a list of
    NAMES, and matching a map outline to an owner by name across two payloads is
    the fragility that already bit the district data. Every state carries its id.
    """

    id: uuid.UUID
    name: str
    #: Is it covered AT ALL? Company-wide truth, so this is the field to colour
    #: by. It is deliberately separate from `coveredBy`: a regional head can see
    #: that a state is taken without being shown the manager, and painting it
    #: "free" because the name is hidden would send them to assign something
    #: that then 409s — a bug this slice already fixed once for
    #: `unassignedStates`.
    isCovered: bool
    #: WHO covers it, when the caller is allowed to know. Null does NOT mean
    #: uncovered; check `isCovered` for that.
    coveredBy: TerritoryPerson | None
    #: True when this state is in the CALLER's own scope. An area manager sees
    #: their whole region, so the map has to distinguish "mine" from "my
    #: colleague's" without the client guessing.
    isMine: bool


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
    #: Every state in this region with its coverage. Kept alongside
    #: `unassignedStates` rather than replacing it — the tree renders names and
    #: has no use for ids.
    states: list[TerritoryState]
