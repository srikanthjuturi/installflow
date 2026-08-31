import { useQuery } from "@tanstack/react-query";

import { lookupCompanyGstin } from "@/services/companies";
import { lookupGstin } from "@/services/vendors";

/**
 * The GST registry lookup — its OWN file and its OWN query root.
 *
 * Not under `useVendors`, for two reasons that both bit once. It is used by the
 * vendor dialog AND the superadmin's company dialog, so living in either slice
 * would make one of them import the other's hooks — the same rule the API
 * settles with `app/core/gst_lookup.py`.
 *
 * And the KEY must stay outside the `vendors` prefix: every vendor write
 * invalidates that whole prefix, which would evict these too, so saving a
 * vendor would throw away what the registry said about its GSTIN and reopening
 * the form would buy the same answer again. It is not our data and a save
 * cannot change it.
 */
export const gstinKeys = {
  lookup: (gstin: string) => ["gstin-lookup", gstin] as const,
};

/**
 * What the GST registry says about one GSTIN.
 *
 * A QUERY, not a mutation, and that is the whole design: the GSTIN is the key,
 * so asking about the same number twice costs one call, not two. Every call
 * spends a unit of a metered subscription, which makes the cache a budget
 * control rather than a nicety.
 *
 * - `staleTime: Infinity` — a registry record does not move during a session.
 * - `retry: false` — retrying an exhausted subscription three times is three
 *   wasted units and the same answer.
 * - `enabled` is the caller's: it passes false until the value is a complete,
 *   well-formed GSTIN, so nothing fires while somebody is still typing.
 *
 * `suppressErrorToast`, unusually — this is one of the few places the screen
 * genuinely owns the message. The form renders "Couldn't check this GSTIN right
 * now" under the field and carries on; a toast would report a degraded
 * convenience as though something had failed.
 */
export function useGstinLookup(
  gstin: string,
  enabled: boolean,
  /**
   * Which endpoint to ask. The ANSWER is identical either way — one registry,
   * one implementation on the server — so the cache key is the GSTIN alone and
   * this only picks the door. A superadmin holds no membership and no company
   * feature, so the vendors route refuses them; that is the whole difference.
   */
  surface: "vendor" | "company" = "vendor"
) {
  return useQuery({
    queryKey: gstinKeys.lookup(gstin),
    queryFn: () =>
      surface === "company" ? lookupCompanyGstin(gstin) : lookupGstin(gstin),
    enabled,
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
    meta: { suppressErrorToast: true },
  });
}
