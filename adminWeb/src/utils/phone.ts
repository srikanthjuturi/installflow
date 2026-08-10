/**
 * Phone numbers in E.164 (`+919876543210`).
 *
 * WhatsApp needs the country code, so a number cannot be stored as ten local
 * digits. The rest of the console still assumes India, which is why a bare
 * 10-digit entry is treated as `+91` — but anything with an explicit country
 * code is kept exactly as typed rather than truncated.
 */

const DEFAULT_COUNTRY = "91";

/** `98220 11223` → `+919822011223`; `+1 555 000 1234` → `+15550001234`. */
export function toE164(raw: string): string {
  const trimmed = raw.trim();
  const hadPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  if (!hadPlus && digits.length === 10) return `+${DEFAULT_COUNTRY}${digits}`;
  return `+${digits}`;
}

/** True for a plausible E.164 number: `+` then 8–15 digits, no leading zero. */
export function isE164(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

/** `+919822011223` → `+91 98220 11223`, for display only. */
export function formatPhone(value: string): string {
  if (!value.startsWith(`+${DEFAULT_COUNTRY}`)) return value;
  const rest = value.slice(3);
  return rest.length === 10
    ? `+${DEFAULT_COUNTRY} ${rest.slice(0, 5)} ${rest.slice(5)}`
    : value;
}
