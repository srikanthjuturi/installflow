/**
 * The backend's machine-readable error codes — the ones this console reads.
 *
 * Mirrors `api/app/core/gst.py`. They are an API surface on the server, so a
 * rename there breaks a screen here the way a renamed field would; keep the two
 * lists in step.
 *
 * Why they exist: the endpoints that save a company or a vendor answer 409 for
 * several unrelated reasons — a duplicate name, a taken login email, and any of
 * the four GSTIN clashes below. Matching on the status alone cannot tell them
 * apart, and matching on the message text breaks the first time somebody
 * rewords it.
 */

/** The GSTIN is the company's own — a vendor is an outside party. */
export const GST_BELONGS_TO_COMPANY = "GST_BELONGS_TO_COMPANY";
/** The GSTIN is already one of the company's vendors'. */
export const GST_BELONGS_TO_VENDOR = "GST_BELONGS_TO_VENDOR";
/** Another vendor in the same company already has it. */
export const GST_DUPLICATE_VENDOR = "GST_DUPLICATE_VENDOR";
/** Another company already has it — platform-wide, unlike the vendor rule. */
export const GST_DUPLICATE_COMPANY = "GST_DUPLICATE_COMPANY";

/** Every GSTIN clash a vendor save can report. Belongs on the GSTIN field. */
export const VENDOR_GST_CODES: readonly string[] = [
  GST_BELONGS_TO_COMPANY,
  GST_DUPLICATE_VENDOR,
];

/** Every GSTIN clash a company save can report. */
export const COMPANY_GST_CODES: readonly string[] = [
  GST_BELONGS_TO_VENDOR,
  GST_DUPLICATE_COMPANY,
];

/* ── geography ────────────────────────────────────────────────────────────── */
/** Mirrors `api/app/features/geo/service.py`. Both belong on one input, which
 *  is the whole reason they carry a code: a pincode save can also 409 for
 *  reasons that are not the code box. */

/** That pincode is already in the master. Belongs on the code field. */
export const PINCODE_EXISTS = "PINCODE_EXISTS";
/** That state already has a district with this name. Belongs on the name field. */
export const DISTRICT_EXISTS = "DISTRICT_EXISTS";

export const PINCODE_CODES: readonly string[] = [PINCODE_EXISTS];
export const DISTRICT_CODES: readonly string[] = [DISTRICT_EXISTS];

/* ── franchisees ─────────────────────────────────────────────────────────── */
/* Mirrors `api/app/features/franchisees` (Task 03), the way the GST codes
   mirror `core/gst.py`. One 409/422 from the screen can mean several
   different things and each needs its own words on screen. */

/**
 * Another franchisee already owns pincode(s) in this commit's ranges — the
 * 409 names them, `errors[]` reads "500032 — SkyFix Services", and the dialogs
 * returns to edit phase and refetches the preview to show who took what.
 */
export const FRANCHISEE_PINCODE_TAKEN = "FRANCHISEE_PINCODE_TAKEN";
/** On the home franchisee: its kind, its pincodes and its deactivation are not
 *  things there is anything to change — "home" IS the rule. */
export const FRANCHISEE_HOME_IMMUTABLE = "FRANCHISEE_HOME_IMMUTABLE";
/** Deactivating is refused while the franchisee still has technicians. */
export const FRANCHISEE_HAS_TECHNICIANS = "FRANCHISEE_HAS_TECHNICIANS";
/** On a create/update of a technician and on direct onboarding: someone else's
 *  pincodes are refused (422). */
export const PINCODE_OUTSIDE_FRANCHISEE = "PINCODE_OUTSIDE_FRANCHISEE";

/**
 * The only active admin of a non-home franchisee cannot be deactivated — add
 * another one first (owner ruling 2026-10-15, R3). The home is exempt.
 */
export const FRANCHISEE_LAST_ADMIN = "FRANCHISEE_LAST_ADMIN";

export const FRANCHISEE_CODES: readonly string[] = [
  FRANCHISEE_PINCODE_TAKEN,
  FRANCHISEE_HOME_IMMUTABLE,
  FRANCHISEE_HAS_TECHNICIANS,
  FRANCHISEE_LAST_ADMIN,
];
