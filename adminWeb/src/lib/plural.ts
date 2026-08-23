/**
 * `plural(1, "district")` -> `"1 district"`, `plural(75, "district")` -> `"75 districts"`.
 *
 * Small, but it earns its place: Chandigarh has exactly ONE district, and
 * "1 districts" is what a screen reader was reading out before this existed.
 * Thousands separators come along for free, which every count on the geography
 * screens wants anyway.
 */
export function plural(n: number, noun: string): string {
  return `${n.toLocaleString()} ${noun}${n === 1 ? "" : "s"}`;
}
