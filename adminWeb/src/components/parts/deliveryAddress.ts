import type { DeliveryAddress } from "@/types/parts";
import { formatPhone } from "@/utils/phone";

/**
 * Where a part request's parcel goes (Epic 6). Pure helpers, so the copy
 * button, the on-screen block and the tests all read one answer.
 */

/** Only the technician's base pincode was on file — there is no street. */
export function isBaseOnly(a: DeliveryAddress): boolean {
  return a.source === "base";
}

/** Short label for the source line. */
export function deliverySourceLabel(a: DeliveryAddress): string {
  return isBaseOnly(a) ? "Base area only" : "Parts address";
}

/** The muted note under a base-only address; null when there is nothing to say. */
export function deliverySourceNote(a: DeliveryAddress): string | null {
  return isBaseOnly(a)
    ? "Only the technician's base pincode is on file — confirm the street with them."
    : null;
}

/**
 * The address as display lines, top to bottom. Empty parts are dropped, so a
 * base-only address is just "Pincode 500001".
 */
export function deliveryLines(a: DeliveryAddress): string[] {
  const lines: string[] = [];
  if (a.line?.trim()) lines.push(a.line.trim());
  if (a.landmark?.trim()) lines.push(`Landmark: ${a.landmark.trim()}`);
  const city = a.city?.trim();
  lines.push(city ? `${city} - ${a.pincode}` : `Pincode ${a.pincode}`);
  return lines;
}

/** What the Copy button puts on the clipboard: multi-line, phone last. */
export function formatDeliveryAddress(a: DeliveryAddress): string {
  const lines = deliveryLines(a);
  if (a.contactPhone) lines.push(`Phone: ${formatPhone(a.contactPhone)}`);
  return lines.join("\n");
}
