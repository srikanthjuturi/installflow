import type { IconName } from './Icon';

/**
 * Server icon key → the glyph this app draws.
 *
 * The keys come from `api/app/core/icons.py`, which validates them, and are
 * lucide's names because that is what the ops console renders. Six of them map
 * onto glyphs that were already traced from the approved prototype — those keep
 * their original short names (`washer`, `fridge`, `ac`, `micro`, `purifier`) so
 * the approved screens are untouched.
 *
 * The catalogue is closed on purpose: a manager can only pick an icon that
 * exists here, because this app hand-traces its SVGs and has no icon font to
 * fall back on.
 */
export const PRODUCT_ICON: Record<string, IconName> = {
  // large appliances — the six from the approved prototype
  tv: 'tv',
  'washing-machine': 'washer',
  refrigerator: 'fridge',
  'air-vent': 'ac',
  microwave: 'micro',
  droplets: 'purifier',
  // large appliances — added with the product master
  fan: 'fan',
  wind: 'wind',
  flame: 'flame',
  // electronics
  laptop: 'laptop',
  smartphone: 'smartphone',
  monitor: 'monitor',
  printer: 'printer',
  camera: 'camera',
  headphones: 'headphones',
  speaker: 'speaker',
  // kitchen & home
  coffee: 'coffee',
  utensils: 'utensils',
  sofa: 'sofa',
  lightbulb: 'lightbulb',
  // power & service
  plug: 'plug',
  battery: 'battery',
  zap: 'zap',
  wrench: 'wrench',
  package: 'package',
};

/** What an unknown or missing key draws. Never throws — a row written by a
 *  newer deploy must still render something rather than blank the tile. */
export const DEFAULT_PRODUCT_ICON: IconName = 'package';

export function productIcon(key: string | null | undefined): IconName {
  return (key && PRODUCT_ICON[key]) || DEFAULT_PRODUCT_ICON;
}
