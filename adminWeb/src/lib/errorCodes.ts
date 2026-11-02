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

/* ── base location ───────────────────────────────────────────────────────── */
/* Mirrors `api/app/core/base_location.py` (Task 10). `PINCODE_OUTSIDE_FRANCHISEE`
   above is shared: it is the same 422 for a coverage pincode and a base one. */

/** The pincode exists but has no centre on file, so a pincode base cannot be
 *  built from it (400). Belongs on the pincode field. */
export const PINCODE_HAS_NO_LOCATION = "PINCODE_HAS_NO_LOCATION";
/** The point is outside India's box (400). Belongs on the coordinates. */
export const BASE_OUTSIDE_INDIA = "BASE_OUTSIDE_INDIA";

/** What the base-location dialog pins on its pincode field. */
export const BASE_PINCODE_CODES: readonly string[] = [
  PINCODE_OUTSIDE_FRANCHISEE,
  PINCODE_HAS_NO_LOCATION,
];
/** What it pins on the latitude/longitude pair. */
export const BASE_POINT_CODES: readonly string[] = [BASE_OUTSIDE_INDIA];

/* ── moving a technician between franchisees ─────────────────────────────── */
/* Mirrors `api/app/core/technician_transfer.py` (Task 17). `PINCODE_OUTSIDE_FRANCHISEE`
   above is shared: the same 422 for "nothing of theirs is inside that area". */

/** The technician still holds a live job (409) — finish or reassign it first. */
export const TECHNICIAN_HAS_OPEN_JOBS = "TECHNICIAN_HAS_OPEN_JOBS";
/** Redeemable money, or a redemption not yet settled (409). */
export const TECHNICIAN_HAS_BALANCE = "TECHNICIAN_HAS_BALANCE";
/** The target is not the home and has no active admin to approve UPI changes
 *  or pay redemptions (409). */
export const FRANCHISEE_HAS_NO_ADMIN = "FRANCHISEE_HAS_NO_ADMIN";

/* ── company <-> franchisee transfers ────────────────────────────────────── */
/* Mirrors `api/app/features/franchise_settlements` (Epic 1.2). The server's own
   sentence is what the toaster shows; the codes are here so a caller that wants
   to pin one to a field, or branch on it, spells it the way the API does. */

/** The home franchisee is the company itself — there is nobody to settle with (409). */
export const HOME_FRANCHISEE_NO_SETTLEMENT = "HOME_FRANCHISEE_NO_SETTLEMENT";
/** Staff recorded a transfer without naming the franchisee (422). */
export const FRANCHISEE_REQUIRED = "FRANCHISEE_REQUIRED";
/** The day sent is after today (422). Belongs on the date field. */
export const DATE_IN_FUTURE = "DATE_IN_FUTURE";
/** The day sent is more than a year back (422). Belongs on the date field. */
export const DATE_TOO_OLD = "DATE_TOO_OLD";
/** The screenshot is missing, or is another account's upload (422). */
export const INVALID_PROOF = "INVALID_PROOF";
/** Reason `other` with no note (422). Belongs on the note field. */
export const NOTE_REQUIRED = "NOTE_REQUIRED";
/** The sender tried to confirm or decline their own transfer (409). */
export const NOT_THE_RECEIVER = "NOT_THE_RECEIVER";
/** Declined is final — record a new transfer instead (409). */
export const ALREADY_DECLINED = "ALREADY_DECLINED";
/** Already confirmed by the other side (409). */
export const ALREADY_CONFIRMED = "ALREADY_CONFIRMED";

export const SETTLEMENT_DATE_CODES: readonly string[] = [
  DATE_IN_FUTURE,
  DATE_TOO_OLD,
];

/* ── numbered documents, statements and email ────────────────────────────── */
/* Mirrors `api/app/features/transactions` (Epic 1.5 - 1.7). */

/** The statement's end date is before its start (422). */
export const BAD_PERIOD = "BAD_PERIOD";
/** The statement spans more than three years (422). */
export const PERIOD_TOO_LONG = "PERIOD_TOO_LONG";
/** A superadmin asked for a statement without naming a company (422). */
export const COMPANY_REQUIRED = "COMPANY_REQUIRED";
/** Unknown party kind, a missing party, or an id on the platform (422). */
export const BAD_PARTY = "BAD_PARTY";
/** Re-send with neither a document nor a date range (422). */
export const RANGE_REQUIRED = "RANGE_REQUIRED";
/** Only the company or the platform may re-send documents (403). */
export const FORBIDDEN = "FORBIDDEN";

export const TRANSACTION_PERIOD_CODES: readonly string[] = [
  BAD_PERIOD,
  PERIOD_TOO_LONG,
];

/* ── per-technician redemption terms ─────────────────────────────────────── */
/* Mirrors `api/app/features/redemptions/service.py` (Epic 3). */

/** The technician's redeemable balance (after any holding) is under the minimum
 *  set for them (409). Shown by the toaster as the server's own sentence. */
export const BELOW_MIN_REDEEMABLE = "BELOW_MIN_REDEEMABLE";
