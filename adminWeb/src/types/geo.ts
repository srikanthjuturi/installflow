/**
 * The geography master — what India is, as opposed to who covers which part of
 * it. Global reference data: the same rows for every company, maintained by a
 * superadmin. Mirrors `api/app/features/geo/schemas.py`.
 */

export interface GeoRegion {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  /** May be 0 — a region nothing sits in is what the Geography screen exists
   *  to surface, so it is never filtered out. */
  stateCount: number;
}

export interface GeoState {
  id: string;
  name: string;
  regionId: string;
  regionName: string;
  isActive: boolean;
  districtCount: number;
  pincodeCount: number;
}

export interface GeoPincode {
  code: string;
  stateId: string;
  stateName: string;
  regionId: string;
  regionName: string;
  /** Usually one, but 1,258 real pincodes span up to four districts. */
  districts: string[];
}

export interface ImportCounts {
  created: number;
  updated: number;
  /** A row that re-parents an existing record — somebody's territory moves
   *  with it, so this is never folded into `updated`. */
  moved: number;
}

export interface ImportReject {
  row: number | null;
  pincode: string | null;
  reason: string;
}

export interface ImportOverride {
  pincode: string;
  state: string;
  reason: string;
  /** "applied" — the file disagreed and was corrected.
   *  "agreed"  — the file already had it right and nothing changed. */
  outcome: "applied" | "agreed";
}

export interface ImportReport {
  dryRun: boolean;
  rowsRead: number;
  /** Rows dropped before validation — the source's own `#N/A` lookup failures. */
  rowsSkipped: number;
  regions: ImportCounts;
  states: ImportCounts;
  districts: ImportCounts;
  pincodes: ImportCounts;
  /** Regions that end up with no states. A regional head given one would cover
   *  nothing, so it is worth saying out loud. */
  unusedRegions: string[];
  overrides: ImportOverride[];
  rejected: number;
  /** Capped by the server; `rejected` carries the true total. */
  rejects: ImportReject[];
}
