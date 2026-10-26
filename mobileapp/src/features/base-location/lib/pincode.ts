/**
 * The home pincode box. Six digits, the first not zero — India's shape.
 *
 * A faster message, not a gate: the server checks the code against the master
 * and the franchisee's range, and is the authority.
 */

/** Digits only, at most six — what the box holds as the technician types or pastes. */
export function cleanPincode(text: string): string {
  return text.replace(/\D/g, '').slice(0, 6);
}

export function isPincode(text: string): boolean {
  return /^[1-9][0-9]{5}$/.test(text);
}
