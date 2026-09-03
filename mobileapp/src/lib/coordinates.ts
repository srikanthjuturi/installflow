/**
 * Distance between two points, mirroring `api/app/core/coordinates.py`.
 *
 * Deliberately a copy, and it has to stay one. The server refuses a live proof
 * photo taken too far from the customer's address; this is what lets the
 * shutter say so BEFORE a technician takes a picture the submit would reject.
 * Two implementations of one formula is a real risk — if they ever disagree the
 * app blocks captures the server would take, or worse, allows ones it will not
 * — so change them together, and keep the constant below identical.
 */

/** Metres. The IUGG mean radius, the same figure the API uses. */
const EARTH_RADIUS_M = 6_371_008.8;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance in metres. Haversine, as on the server. */
export function metresBetween(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const dPhi = toRadians(lat2 - lat1);
  const dLambda = toRadians(lon2 - lon1);

  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/** `420 m` below a kilometre, `4.2 km` above it. Matches the server's wording. */
export function metresLabel(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} m`;
}

/**
 * Is this fix too far from the job to allow the shutter?
 *
 * The phone's own reported accuracy is subtracted first, capped at one radius.
 * That credit is not politeness — the rule it replaces (pincode equality) had
 * an accidental escape hatch, because it no-opped whenever reverse geocoding
 * failed, which on Android needs a network. Without an equivalent, a technician
 * in a basement car park with a ±2 km fix could not start the job at all, and
 * their only way out would be a cancellation penalty for a GPS problem. The cap
 * is what stops a phone claiming ±50 km from switching the check off entirely.
 *
 * The server computes exactly this. See `_check_live_was_taken_at_the_job`.
 */
export function isTooFar(
  distanceM: number,
  accuracyM: number | null,
  radiusM: number,
): boolean {
  return distanceM - Math.min(accuracyM ?? 0, radiusM) > radiusM;
}
