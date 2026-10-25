import type { UpiChange } from "./technician";
import type { NodeOption } from "./product";

/**
 * Types owned by the franchise portal — Task 09 §5.3. The wire shapes are the
 * staff twins' (technician, redemption, ledger); only what the portal adds is
 * declared here, so a change to `Technician` or `LedgerEntry` reaches both
 * surfaces without a second edit.
 */

/** Re-exported to `types/api.ts`'s `MeResponse.franchisee` consumers. */
export type { MeFranchisee } from "./api";

/**
 * The two pick lists the technician form needs, from the one options endpoint.
 *
 * The staff form reads them from staff-only doors (`/masters/nodes`, which is
 * `masters.view`, and territory-scoped regions); granting a franchisee admin
 * the whole catalogue read surface to fill one checkbox list was rejected —
 * the endpoint returns exactly what the form renders.
 */
export interface TechnicianOptions {
  /** Regions holding at least one pincode this franchisee owns. */
  regions: Array<{ id: string; name: string }>;
  /**
   * The CERTIFY_DEPTH nodes a technician may certify on — active, company-wide,
   * each carrying its root for the form's grouped picker.
   */
  subcategories: Array<{
    id: string;
    name: string;
    rootId: string;
    rootName: string;
    pathLabel: string;
  }>;
}

/**
 * Map a technician-options subcategory onto the `NodeOption` shape the form's
 * grouped category picker already renders (`groupByRoot` reads `rootId`,
 * `rootName`; the checkbox list itself wants `id`, `name`, `pathLabel`).
 *
 * Pure and tolerant of the wire's sparseness: the options endpoint sends
 * exactly the five fields the picker needs, so the surface fields that a tree
 * node carries are filled with the truth "no tree here" — never a leaf, never
 * a parent, never an icon beyond the default. What it renders is unchanged.
 */
export function toNodeOption(
  subcategories: TechnicianOptions["subcategories"]
): NodeOption[] {
  return subcategories.map((s) => ({
    id: s.id,
    name: s.name,
    pathLabel: s.pathLabel,
    iconKey: "category" as NodeOption["iconKey"],
    depth: 1,
    rootId: s.rootId,
    rootName: s.rootName,
    isLeaf: true,
    hasChildren: false,
    hasModels: false,
  }));
}

/**
 * A row of the UPI changes queue — a `UpiChange` plus the technician it is
 * about, because the queue is where the decision starts and the technician
 * link is what carries it to the profile.
 */
export type UpiChangeRow = UpiChange & {
  technicianId: string;
  technicianName: string;
  /** `TCH-4021` — what a person quotes, not the UUID beside it. */
  technicianCode: string;
};

/**
 * One IST calendar month the statements picker offers. `value` is the wire's
 * `?month=`; `isCurrent` is whether the month has not yet closed (IST — the
 * payroll month runs a calendar behind).
 */
export interface StatementMonth {
  value: string; // "YYYY-MM"
  label: string; // "September 2026"
  isCurrent: boolean;
}

/**
 * A pincode inside this franchisee, with where it is — the coverage picker's
 * row. Field-for-field `FranchisePincodeOut` in
 * `api/app/features/franchise_portal/schemas.py`, which duplicates
 * `features/geo`'s `PincodeOut` (lat/long joined in Task 10) rather than
 * importing the feature. Same names, same meaning, change both.
 */
export interface FranchisePincode {
  code: string;
  stateId: string;
  stateName: string;
  regionId: string;
  regionName: string;
  /** District names, for reading — usually one, never guaranteed. */
  districts: string[];
  /** The same districts by id, in the same order. A name is not an identity. */
  districtIds: string[];
  /** Always true on this read: pickers show what can be offered. */
  isActive: boolean;
  /** `'import' | 'manual'` — carried, not used; the portal never edits a row. */
  source: string;
  /** The code's centre (Task 10 §4.7) — null until coordinates are loaded. */
  latitude?: number | null;
  longitude?: number | null;
}