import { apiGet } from "./http";
import type { TerritoryRegion } from "@/types/territory";

/**
 * Territory mapping: Region → Regional Head → Area Manager → serviced pincodes.
 * The National Head sits above the RH but owns no pincodes, so it is not part
 * of this mapping.
 *
 * Read-only: the mapping is made by assigning users a region/pincodes on the
 * Users & Roles screen, so there is nothing to create here.
 */
export function listTerritory(): Promise<TerritoryRegion[]> {
  return apiGet<TerritoryRegion[]>("/territory");
}
