/**
 * Which colour each region wears, as whole Tailwind class strings.
 *
 * Written out in full because an interpolated `bg-${slot}` is never generated
 * by the Tailwind scanner and renders transparent — the same rule the mobile
 * app states outright.
 *
 * Keyed by the region's **code**, not its position in the list. Colour follows
 * the entity: filtering the page down to two regions must not repaint them, and
 * importing a sixth region must not shuffle the five that were already there.
 */

export interface RegionTone {
  /** A filled block. Any label ON it must be >=18.66px bold — see the contrast
   *  note in `theme.css`. */
  fill: string;
  /** An SVG `fill`, for the map. Spelled out rather than derived from `fill`
   *  above: `fill.replace("bg-", "fill-")` builds the class at RUNTIME, and a
   *  class Tailwind never saw in the source is never generated — the state
   *  renders transparent. */
  mapFill: string;
  /** The legend swatch and any small mark beside text. */
  swatch: string;
  /** A tinted row/card background, for the detail panel. */
  soft: string;
  /** A left rule that carries the hue where a fill would be too loud. */
  rule: string;
}

const NEUTRAL: RegionTone = {
  fill: "bg-chart-empty",
  mapFill: "fill-chart-empty",
  swatch: "bg-chart-empty",
  soft: "bg-surface-2",
  rule: "border-l-line",
};

const TONES: Record<string, RegionTone> = {
  NORTH: {
    fill: "bg-chart-1",
    mapFill: "fill-chart-1",
    swatch: "bg-chart-1",
    soft: "bg-chart-1/10",
    rule: "border-l-chart-1",
  },
  SOUTH: {
    fill: "bg-chart-2",
    mapFill: "fill-chart-2",
    swatch: "bg-chart-2",
    soft: "bg-chart-2/10",
    rule: "border-l-chart-2",
  },
  EAST: {
    fill: "bg-chart-3",
    mapFill: "fill-chart-3",
    swatch: "bg-chart-3",
    soft: "bg-chart-3/10",
    rule: "border-l-chart-3",
  },
  WEST: {
    fill: "bg-chart-4",
    mapFill: "fill-chart-4",
    swatch: "bg-chart-4",
    soft: "bg-chart-4/10",
    rule: "border-l-chart-4",
  },
};

/**
 * The tone for a region code.
 *
 * A region the palette has no hue for — Central today, or anything a future
 * import adds — gets the neutral rather than a generated colour. The palette is
 * four fixed hues and a fifth is never invented; the legend still names the
 * region and gives its count, so nothing about it is hidden, and a region with
 * no states paints nothing on the map anyway.
 */
export function toneFor(regionCode: string): RegionTone {
  return TONES[regionCode.toUpperCase()] ?? NEUTRAL;
}

/** True when this region has no hue of its own — the legend says so out loud. */
export function isNeutral(regionCode: string): boolean {
  return !(regionCode.toUpperCase() in TONES);
}
