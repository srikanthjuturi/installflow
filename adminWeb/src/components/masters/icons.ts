import type { LucideIcon } from "lucide-react";
import {
  AirVent,
  Battery,
  Camera,
  Coffee,
  Droplets,
  Fan,
  Flame,
  Headphones,
  Laptop,
  Lightbulb,
  Microwave,
  Monitor,
  Package,
  Plug,
  Printer,
  Refrigerator,
  Smartphone,
  Sofa,
  Speaker,
  Tv,
  Utensils,
  WashingMachine,
  Wind,
  Wrench,
  Zap,
} from "lucide-react";

/**
 * The curated product-icon catalogue, web half.
 *
 * The same keys live in `api/app/core/icons.py` (which validates them) and in
 * `mobileapp/src/components/icons/Icon.tsx` (which draws them). Keeping the set
 * closed is what stops a manager picking an icon the technician's phone cannot
 * render — the mobile app hand-traces its SVGs and has no icon font to fall
 * back on.
 *
 * Keys are lucide's own kebab-case names, so this map is mechanical. Order is
 * the catalogue order the picker renders in.
 */
export const PRODUCT_ICONS = {
  // large appliances
  tv: Tv,
  "washing-machine": WashingMachine,
  refrigerator: Refrigerator,
  "air-vent": AirVent,
  microwave: Microwave,
  droplets: Droplets,
  fan: Fan,
  wind: Wind,
  flame: Flame,
  // electronics
  laptop: Laptop,
  smartphone: Smartphone,
  monitor: Monitor,
  printer: Printer,
  camera: Camera,
  headphones: Headphones,
  speaker: Speaker,
  // kitchen & home
  coffee: Coffee,
  utensils: Utensils,
  sofa: Sofa,
  lightbulb: Lightbulb,
  // power & service
  plug: Plug,
  battery: Battery,
  zap: Zap,
  wrench: Wrench,
  // fallback, and a legitimate choice for a category with no obvious glyph
  package: Package,
} satisfies Record<string, LucideIcon>;

export type IconKey = keyof typeof PRODUCT_ICONS;

export const ICON_KEYS = Object.keys(PRODUCT_ICONS) as IconKey[];

/** What every surface falls back to for an unknown or missing key. */
export const DEFAULT_ICON_KEY: IconKey = "package";

/**
 * Never throws on an unknown key. The catalogue is closed, but a row written by
 * an older deploy must still render something rather than crash the tree.
 */
export function iconFor(key: string | null | undefined): LucideIcon {
  return PRODUCT_ICONS[key as IconKey] ?? PRODUCT_ICONS[DEFAULT_ICON_KEY];
}

/** Sentence-case label for the picker's accessible name, e.g. "Washing machine". */
export function iconLabel(key: IconKey): string {
  const words = key.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
