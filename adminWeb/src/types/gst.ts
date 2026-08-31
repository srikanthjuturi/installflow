/**
 * What the GST registry says about a GSTIN.
 *
 * Its own file, not `vendor.ts`, because two unrelated forms fill themselves
 * from it — the vendor dialog and the superadmin's company dialog. They call
 * different endpoints (`/vendors/gstin-lookup`, `/companies/gstin-lookup`)
 * only because a superadmin holds no membership and no company feature, so the
 * vendors route refuses them; the answer is identical, and so is the code
 * behind it (`api/app/core/gst_lookup.py`).
 *
 * **Three outcomes, and two of them are not the same failure.**
 *
 * - `found` — the fields below are filled.
 * - `not_registered` — a real answer about the GSTIN. **Block the save.**
 * - `unavailable` — we could not ask (our subscription is spent or lapsed, or
 *   the portal is down). **Block nothing.** A billing problem of ours is not a
 *   reason somebody cannot record a company they have the paperwork for.
 *
 * Both endpoints answer 200 in all three cases: this is a result to render, not
 * an error to catch. Only these fields cross the boundary — the API never
 * forwards the provider's payload.
 */
export type GstinOutcome = "found" | "not_registered" | "unavailable";

export interface GstinLookup {
  outcome: GstinOutcome;
  /** Why, when the outcome is not `found`. */
  reason: string | null;
  /** The trading name, falling back to the legal name — what goes in the box. */
  name: string | null;
  /** Sent ONLY when it differs from `name`; null is the normal case. */
  legalName: string | null;
  pan: string | null;
  gstCompanyStatus: string | null;
  /** Set only on a cancelled registration. Shown, never stored. */
  cancellationDate: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}
