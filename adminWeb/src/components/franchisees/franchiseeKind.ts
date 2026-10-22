/**
 * The kind's presentation vocabulary, in its own module because a file that
 * exports a component may export nothing else (fast refresh) — and the table,
 * the facts card and the form dialog all read the WORDS while the wire takes
 * the lowercase, converted per call site.
 */

/** The two kinds, as the FORM holds them. */
export const KIND_OPTIONS = ["Internal", "External"] as const;
export type KindWord = (typeof KIND_OPTIONS)[number];

export const KIND_WORD_TO_WIRE = {
  Internal: "internal",
  External: "external",
} as const satisfies Record<KindWord, "internal" | "external">;

export function wireKindToWord(kind: "internal" | "external"): KindWord {
  return kind === "internal" ? "Internal" : "External";
}