import {
  LIVE_TICKET_STATUSES,
  type LiveLocation,
} from "@/types/liveLocation";

/**
 * Pure helpers for the live-location card and page (Epic 4).
 *
 * The one idea to keep straight: `stale` means "their phone is not reporting
 * right now", never "they are at this place". The wording below is built so a
 * stale point can never read as a current one.
 */

/** Poll cadence - only while the tab is visible and the view is mounted. */
export const LIVE_REFETCH_MS = 20_000;
/** A ticket whose phone is not sharing is re-asked this slowly. */
export const IDLE_REFETCH_MS = 60_000;

/** Whether a ticket of this status can have a live location at all. */
export function isLiveStatus(status: string | null | undefined): boolean {
  return (LIVE_TICKET_STATUSES as readonly string[]).includes(status ?? "");
}

const EARTH_RADIUS_KM = 6371.0088;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres. */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "850 m" under a kilometre, "12.4 km" under 100, "134 km" beyond. */
export function distanceLabel(km: number): string {
  if (!Number.isFinite(km) || km < 0) return "—";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 100) return `${(Math.round(km * 10) / 10).toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

/**
 * The distance from the technician to the customer, or null when the job has
 * no map pick of its own (the caller then draws no customer pin and no label).
 */
export function distanceToCustomer(l: LiveLocation): string | null {
  if (l.customerLatitude === null || l.customerLongitude === null) return null;
  return distanceLabel(
    haversineKm(
      { lat: l.latitude, lng: l.longitude },
      { lat: l.customerLatitude, lng: l.customerLongitude }
    )
  );
}

/** "40 s", "5 min", "3 h", "2 d" - no "ago", so callers can build a sentence. */
export function ageSpan(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

/** "Updated 12 s ago" for a live point. */
export function updatedText(seconds: number): string {
  return Math.max(0, seconds) < 5
    ? "Updated just now"
    : `Updated ${ageSpan(seconds)} ago`;
}

/** The sentence a stale point carries - never presented as current. */
export function staleText(seconds: number): string {
  return `Last seen ${ageSpan(seconds)} ago — their phone is not reporting`;
}

/** The one line for a point: stale or fresh. */
export function freshnessText(l: Pick<LiveLocation, "stale" | "ageSeconds">) {
  return l.stale ? staleText(l.ageSeconds) : updatedText(l.ageSeconds);
}

/** "Hyderabad 500001", "500001", "Hyderabad" or "—". */
export function placeText(l: Pick<LiveLocation, "city" | "pincode">): string {
  return [l.city, l.pincode].filter(Boolean).join(" ") || "—";
}

/** "±25 m" or null when the phone did not say. */
export function accuracyText(accuracyM: number | null): string | null {
  if (accuracyM === null || !Number.isFinite(accuracyM) || accuracyM <= 0)
    return null;
  return `±${Math.round(accuracyM)} m`;
}

/** How many of these points are reporting, and how many are not. */
export function summaryCounts(rows: Array<{ stale: boolean }>) {
  const stale = rows.filter((r) => r.stale).length;
  return { live: rows.length - stale, stale };
}
