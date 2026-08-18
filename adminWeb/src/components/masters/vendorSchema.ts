import { z } from "zod";
import type { IntakeChannel } from "@/types/vendor";

/**
 * Mirrors the Pydantic types in `api/app/core/statutory.py`. Keeping the
 * patterns identical means a form that submits is a form the API accepts —
 * the alternative is a round trip that fails on the character the user typed
 * twenty seconds ago.
 *
 * Everything normalises before it validates, for the same reason the server
 * does: a GSTIN pasted as " 29aaaaa0000a1z5 " is the same GSTIN, and rejecting
 * it punishes the clipboard rather than the data.
 */

/** 2-digit state code, 10-char PAN, entity number, 'Z', checksum. */
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
/**
 * 21 chars: listed/unlisted flag, 5-digit industry code, 2-letter state,
 * 4-digit year, 3-letter company class, 6-digit registration number.
 */
const CIN_RE = /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;
const PINCODE_RE = /^[0-9]{6}$/;
/** 10 digits, optionally with a +91 or 0 in front. The API stores E.164. */
const PHONE_RE = /^(?:\+?91|0)?[6-9][0-9]{9}$/;

/**
 * §4 — there are exactly three intake channels, and only one of them is an
 * integration. Most vendors have no CRM, so Excel and Manual are primary paths
 * rather than fallbacks. Mirrors INTAKE_CHANNELS in `app/core/intake.py`.
 *
 * `satisfies` keeps this honest if the `IntakeChannel` union ever changes.
 */
export const INTAKE_CHANNELS = [
  "API",
  "Excel",
  "Manual",
] as const satisfies readonly IntakeChannel[];

/**
 * One line per channel, shown under the option so the choice is not a guess.
 * Approved prototype copy — do not reword.
 *
 * The server sends these too, on `GET /vendors/channels`, and that is the
 * authority. This is the fallback the form renders while that request is in
 * flight, so the checkbox list never appears momentarily unlabelled.
 */
export const CHANNEL_HINT: Record<IntakeChannel, string> = {
  API: "Tickets are pushed from the vendor's own system.",
  Excel: "Ops upload the vendor's spreadsheet.",
  Manual: "Ops key each ticket in by hand.",
};

/**
 * Last-resort availability, used ONLY when `GET /vendors/channels` fails.
 *
 * Mirrors AVAILABLE_INTAKE_CHANNELS in `app/core/intake.py`. Deliberately not
 * consulted on the happy path — the server is the authority, so enabling API
 * there needs no change here. This exists so a dropped request degrades to a
 * usable form instead of one where every box is disabled.
 *
 * It errs safe in the only direction that matters: it can offer fewer channels
 * than the server allows, never more, and the server refuses the difference.
 */
export const LOCAL_AVAILABLE: readonly IntakeChannel[] = ["Excel", "Manual"];

/** Which of our own screens serves each channel. Null where nobody's does. */
export const CHANNEL_SCREEN: Record<IntakeChannel, string | null> = {
  API: null,
  Excel: "Bulk Upload",
  Manual: "Manual Entry",
};

export const VENDOR_STATUSES = ["Active", "Paused"] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

export const statusOf = (isActive: boolean): VendorStatus =>
  isActive ? "Active" : "Paused";

const upper = (v: string) => v.trim().toUpperCase();
const squash = (v: string) => v.replace(/\s+/g, "");

export const vendorSchema = z.object({
  name: z.string().trim().min(2, "Vendor name is required"),
  gstNumber: z
    .string()
    .transform(upper)
    .pipe(z.string().regex(GSTIN_RE, "That is not a valid 15-character GSTIN")),
  /**
   * Optional: only an MCA-registered company has a CIN. An empty box means
   * "not recorded", which the API stores as null — never an empty string.
   */
  cin: z
    .string()
    .transform(upper)
    .refine((v) => v === "" || CIN_RE.test(v), "That is not a valid 21-character CIN"),
  contactPerson: z.string().trim().min(2, "Contact person is required"),
  phone: z
    .string()
    .transform(squash)
    .pipe(z.string().regex(PHONE_RE, "Enter a 10-digit Indian mobile number")),
  address: z.string().trim().min(1, "Address is required").max(500),
  city: z.string().trim().min(1, "City is required").max(120),
  state: z.string().trim().min(1, "State is required").max(120),
  pincode: z
    .string()
    .transform(squash)
    .pipe(z.string().regex(PINCODE_RE, "Pincodes are 6 digits")),
  /**
   * At least one. Which channels may actually be TICKED is the server's call,
   * fetched from `/vendors/channels` — not encoded here, so that enabling API
   * needs no frontend change at all.
   */
  intakeChannels: z
    .array(z.enum(INTAKE_CHANNELS))
    .min(1, "Pick at least one way tickets arrive"),
  status: z.enum(VENDOR_STATUSES),
});

export type VendorFormValues = z.infer<typeof vendorSchema>;
