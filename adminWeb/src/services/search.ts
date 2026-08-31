/**
 * Global search — live FastAPI, both halves.
 *
 * Two calls because the panel has two states: the preview that opens under the
 * box, and one type paged for its infinite scroll. They hit the same statements
 * on the server, so a drill-down can never disagree with the group it came from.
 */

import { apiGet, apiGetPage } from "./http";
import type { ListParams, Page } from "@/types/api";
import type { SearchHit, SearchPreview, SearchType } from "@/types/search";

/** The top few of every type the caller may see. */
export function searchPreview(search: string): Promise<SearchPreview> {
  return apiGet<SearchPreview>(
    `/search?search=${encodeURIComponent(search)}`
  );
}

/** One page of one type. */
export function searchByType(
  type: SearchType,
  search: string,
  params: Omit<ListParams, "search"> = {}
): Promise<Page<SearchHit>> {
  return apiGetPage<SearchHit>(`/search/${type}`, { ...params, search });
}
