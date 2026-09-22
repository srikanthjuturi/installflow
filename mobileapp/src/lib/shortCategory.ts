/**
 * The short name a category goes by where the full one would wrap — Profile's
 * coverage row, the pool's filter chips. One map, so the two never abbreviate
 * the same category differently.
 *
 * Keyed by name rather than by id: the catalogue is per-company and editable,
 * so an id here would be a value from one tenant's database baked into the app.
 * A name with no entry falls through unabbreviated.
 */
const SHORT_CATEGORY: Record<string, string> = {
  Television: 'TV',
  'Air Conditioner': 'AC',
  'Water Purifier': 'Purifier',
};

export function shortCategory(name: string): string {
  return SHORT_CATEGORY[name] ?? name;
}
