/**
 * The territory picture: region → regional heads → area managers → pincodes.
 *
 * Derived from user assignments — there are no mapping records. Assigning a
 * user to a region or a pincode IS the mapping, so this view is read-only.
 */

export interface TerritoryPerson {
  membershipId: string;
  name: string;
  email: string;
  isActive: boolean;
}

export interface TerritoryAreaManager extends TerritoryPerson {
  pincodes: string[];
}

export interface TerritoryRegion {
  id: string;
  code: string;
  name: string;
  regionalHeads: TerritoryPerson[];
  areaManagers: TerritoryAreaManager[];
  pincodeCount: number;
}
