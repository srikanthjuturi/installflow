import { round5 } from '@/features/base-location/lib/coords';

/**
 * What the map page tells the app.
 *
 * `postMessage` is untrusted input: the page is ours, but the WebView runs
 * remote JavaScript (Leaflet from a CDN). Every message goes through
 * `parseMapMessage` and nothing is ever evaluated or spread into state.
 */
export type MapMessage =
  | { type: 'ready' }
  | { type: 'moved'; lat: number; lng: number }
  | { type: 'failed'; reason: 'leaflet' | 'tiles' };

const REASONS = ['leaflet', 'tiles'] as const;

/** A finite number on the globe — not necessarily in India (the screen checks that). */
function onGlobe(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
}

/** The message, or `null` for anything that is not exactly one of the three. */
export function parseMapMessage(raw: string): MapMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;

  const { type, lat, lng, reason } = data as Record<string, unknown>;
  if (type === 'ready') return { type: 'ready' };
  if (type === 'moved') {
    // India is deliberately not enforced here: the screen shows "outside
    // India" and disables Save, so the pin can still be dragged back.
    return onGlobe(lat, 90) && onGlobe(lng, 180)
      ? { type: 'moved', lat: round5(lat), lng: round5(lng) }
      : null;
  }
  if (type === 'failed') {
    const found = REASONS.find((r) => r === reason);
    return found ? { type: 'failed', reason: found } : null;
  }
  return null;
}
