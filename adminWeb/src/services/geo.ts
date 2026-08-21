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
  filters: { stateId?: string; regionId?: string } = {}
): Promise<Page<GeoPincode>> {
  const merged: Record<string, string> = { ...params.filters };
  if (filters.stateId) merged.stateId = filters.stateId;
  if (filters.regionId) merged.regionId = filters.regionId;
  return apiGetPage<GeoPincode>("/geo/pincodes", { ...params, filters: merged });
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
