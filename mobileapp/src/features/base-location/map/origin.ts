/**
 * `https://host:port` of a URL, or null when it has none.
 *
 * A regex rather than `new URL(...).origin`: React Native's URL polyfill has
 * historically left getters unimplemented, and this runs on the map screen's
 * first render.
 */
export function originOf(url: string): string | null {
  const match = /^(https?:\/\/[^/?#]+)/i.exec(url);
  return match?.[1] ?? null;
}
