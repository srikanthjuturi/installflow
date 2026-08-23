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

export interface TerritoryState {
  id: string;
  name: string;
  /**
   * Is it covered AT ALL? Company-wide truth, and the field to colour by.
   * Deliberately separate from `coveredBy`: a regional head can see a state is
   * taken without being shown the manager, and painting it "free" because the
   * name is hidden would send them to assign something that then 409s.
   */
  isCovered: boolean;
  /** WHO covers it, when the caller may know. Null does NOT mean uncovered. */
  coveredBy: TerritoryPerson | null;
  /** In the CALLER's own scope. An area manager sees their whole region, so
   *  the map has to tell "mine" from "my colleague's" without guessing. */
  isMine: boolean;
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
  /** Every state in this region with its coverage — what the map draws. */
  states: TerritoryState[];
}
