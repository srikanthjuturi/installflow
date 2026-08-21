/**
 * The territory picture: region → regional heads → area managers → states.
 *
 * Derived from user assignments — there are no mapping records. Assigning a
 * user to a region or a set of states IS the mapping, so this view is read-only.
 */

export interface TerritoryPerson {
  membershipId: string;
  name: string;
  email: string;
  isActive: boolean;
}

export interface TerritoryAreaManager extends TerritoryPerson {
  /** The states he covers within the region being drawn. He covers every
   *  pincode inside them, which is derived and far too long to list. */
  states: string[];
}

export interface TerritoryRegion {
  id: string;
  code: string;
  name: string;
  regionalHeads: TerritoryPerson[];
  areaManagers: TerritoryAreaManager[];
  /** States in this region no area manager covers — the gap to fill, which is
   *  more useful than a total nobody can act on. */
  unassignedStates: string[];
  stateCount: number;
}
