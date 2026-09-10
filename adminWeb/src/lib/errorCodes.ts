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
