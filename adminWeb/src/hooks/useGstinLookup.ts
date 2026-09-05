import { useQuery } from "@tanstack/react-query";

import { lookupCompanyGstin } from "@/services/companies";
import { lookupGstin } from "@/services/vendors";

/**
 * The GSTIN lookup — its OWN file and its OWN query root.
 *
 * Not under `useVendors`, for two reasons that both bit once. It is used by the
 * vendor dialog AND the superadmin's company dialog, so living in either slice
 * would make one of them import the other's hooks — the same rule the API
 * settles with `app/core/gst_lookup.py`.
 *
 * And the KEY must stay outside the `vendors` prefix: every vendor write
 * invalidates that whole prefix, which would evict these too, so saving a
 * vendor would throw away what was said about its GSTIN and reopening the form
 * would buy the same answer again.
 *
 * `excludeId` is part of the key because it changes the ANSWER, not just the
 * request: the same GSTIN is `already_registered` when adding and `found` when
 * editing the very row that holds it. Sharing one entry between the two would
 * make an edit refuse itself, or an add accept a duplicate, depending on which
 * dialog opened first.
 */
export const gstinKeys = {
  lookup: (gstin: string, excludeId?: string) =>
    ["gstin-lookup", gstin, excludeId ?? null] as const,
};

/**
 * What we know about one GSTIN — ours, then the registry's.
 *
 * A QUERY, not a mutation, and that is the whole design: the GSTIN is the key,
 * so asking about the same number twice costs one call, not two. A call that
 * reaches the registry spends a unit of a metered subscription, which makes the
 * cache a budget control rather than a nicety.
 *
 * - `staleTime: Infinity` — a registry record does not move during a session.
 * - `retry: false` — retrying an exhausted subscription three times is three
 *   wasted units and the same answer.
 * - `enabled` is the caller's: it passes false until the value is a complete,
 *   well-formed GSTIN, so nothing fires while somebody is still typing — and on
 *   an edit, until the GSTIN actually differs from the saved one, since asking
 *   about a number we already store the answer to buys nothing.
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
   * Which endpoint to ask. The registry's half of the answer is identical
   * either way — one registry, one implementation on the server — and this
   * picks the door. It also picks the SCOPE of the "do we already hold this?"
   * half, which is not identical: the vendor route may only ever ask about the
   * caller's own tenant. A superadmin holds no membership and no company
   * feature, so the vendors route refuses them outright.
   */
  surface: "vendor" | "company" = "vendor",
  /** The row being edited, so it is not reported as its own clash. */
  excludeId?: string
) {
  return useQuery({
    queryKey: gstinKeys.lookup(gstin, excludeId),
    queryFn: () =>
      surface === "company"
        ? lookupCompanyGstin(gstin, excludeId)
        : lookupGstin(gstin, excludeId),
    enabled,
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
    meta: { suppressErrorToast: true },
  });
}
