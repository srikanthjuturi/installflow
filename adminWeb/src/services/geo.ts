/**
 * The geography master — `GET /geo/*`, plus the superadmin importer.
 *
 * The two reads need no feature key: geography is reference data every screen
 * with a state or pincode picker depends on. The import is superadmin-only and
 * the server enforces that.
 */

import { apiGet, apiGetPage, apiUpload } from "./http";
import type { ListParams, Page } from "@/types/api";
import type {
  GeoDistrict,
  GeoPincode,
  GeoRegion,
  GeoState,
  ImportReport,
} from "@/types/geo";

/** Mirrors MAX_UPLOAD_BYTES in app/features/geo/service.py. Not the 8 MB image
 *  ceiling — a spreadsheet never goes near blob storage. */
export const MAX_IMPORT_BYTES = 16 * 1024 * 1024;

export const IMPORT_ACCEPT = ".xlsx,.csv";

/**
 * Regions with their state counts, including empty ones.
 *
 * NOT `listRegions` from `companyUsers.ts`. That one calls `/regions`, which is
 * guarded by `CompanyPrincipal` and **403s for a superadmin** — so the console
 * screen that maintains geography cannot use it.
 */
export function listGeoRegions(): Promise<GeoRegion[]> {
  return apiGet<GeoRegion[]>("/geo/regions");
}

/** Every state with its region and counts. 36 rows — reference data, cache hard. */
export function listStates(): Promise<GeoState[]> {
  return apiGet<GeoState[]>("/geo/states");
}

/**
 * Paginated pincodes. This is what a coverage picker searches.
 *
 * The filters go through `ListParams.filters`, which `queryString` flattens
 * alongside page/limit/search — NOT appended to the path. Building the query
 * by hand produced `/geo/pincodes?regionId=…?page=1`, two `?` in one URL, and
 * every request 422'd.
 */
export function listPincodes(
  params: ListParams = {},
  filters: PincodeFilters = {}
): Promise<Page<GeoPincode>> {
  const merged: Record<string, string> = { ...params.filters };
  if (filters.stateId) merged.stateId = filters.stateId;
  if (filters.regionId) merged.regionId = filters.regionId;
  if (filters.districtId) merged.districtId = filters.districtId;
  // Only ever sent when true — `noDistrict=false` is the default and adding it
  // to the key would split the cache for no reason.
  if (filters.noDistrict) merged.noDistrict = "true";
  return apiGetPage<GeoPincode>("/geo/pincodes", { ...params, filters: merged });
}

export interface PincodeFilters {
  stateId?: string;
  regionId?: string;
  districtId?: string;
  /**
   * The pincodes in no district at all — four of them nationally. Without this
   * they are unreachable by drilling down: present in the state's total and in
   * none of its districts, which reads as a counting bug.
   */
  noDistrict?: boolean;
}

/**
 * Districts, with their pincode counts. Unpaged: 754 in all and at most 75 in
 * one state, so a page control would be furniture.
 *
 * Their counts do not sum to the state's — see `GeoDistrict.pincodeCount`.
 */
export function listDistricts(
  filters: { stateId?: string; regionId?: string } = {}
): Promise<GeoDistrict[]> {
  const query = new URLSearchParams();
  if (filters.stateId) query.set("stateId", filters.stateId);
  if (filters.regionId) query.set("regionId", filters.regionId);
  const qs = query.toString();
  return apiGet<GeoDistrict[]>(`/geo/districts${qs ? `?${qs}` : ""}`);
}

/**
 * One pincode, or null if the master does not hold it.
 *
 * There is no `GET /geo/pincodes/{code}`, and `search` is a PREFIX match on the
 * code — which for a full six digits is already exact, since every code is
 * exactly six characters. But `search` also matches state and district names,
 * so the returned code is compared rather than trusted: a `totalRecords > 0`
 * test would call a typo serviceable the moment it happened to spell a place.
 *
 * Null is a real answer ("we don't cover that"), which is why it is returned
 * rather than thrown. A thrown error means we could not ASK, and the two must
 * not be conflated — see `usePincodeLookup`.
 */
export async function lookupPincode(code: string): Promise<GeoPincode | null> {
  const page = await listPincodes({ search: code, limit: 1 });
  return page.rows[0]?.code === code ? page.rows[0] : null;
}

/**
 * Upload the spreadsheet. `dryRun` validates and writes nothing, which is what
 * the preview step sends; the same file is sent again to commit.
 *
 * Two uploads rather than a server-side batch: the file is a few MB, and a
 * batch table would exist only to carry state between two clicks.
 */
export function importGeography(
  file: File,
  { dryRun }: { dryRun: boolean }
): Promise<ImportReport> {
  const form = new FormData();
  // A part with no filename is not treated as a file upload at all, and the
  // server reads the extension off it to choose the parser.
  form.append("file", file, file.name);
  return apiUpload<ImportReport>(`/geo/import?dryRun=${dryRun}`, form);
}
