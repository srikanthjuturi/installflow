/**
 * India's bounding box — mirrors `INDIA_LAT` / `INDIA_LON` in
 * `api/app/core/coordinates.py`. The server refuses a base outside it
 * (`BASE_OUTSIDE_INDIA`); this lets the screen say so before the tap. Change
 * the two together.
 */
export const INDIA = { lat: [6, 38], lng: [68, 98] } as const;

/** Where the map opens when there is nothing better: the middle of the country. */
export const INDIA_CENTRE = { lat: 22.5, lng: 79.0, zoom: 5 } as const;

/** Inclusive at every edge, like the server's check. */
export function inIndia(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= INDIA.lat[0] &&
    lat <= INDIA.lat[1] &&
    lng >= INDIA.lng[0] &&
    lng <= INDIA.lng[1]
  );
}

/** Five decimal places — about a metre, and what is sent. Symmetric about zero. */
export function round5(n: number): number {
  const rounded = Math.round(Math.abs(n) * 1e5) / 1e5;
  return n < 0 ? -rounded : rounded;
}
