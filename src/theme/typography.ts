/**
 * Type scale extracted from the approved prototype (Roboto, 11–25px).
 *
 * The prototype leans on very heavy weights (800/900) for numbers and
 * headings — that's a signature of the field-utility look, so we load real
 * Roboto rather than relying on the platform default.
 */

export const font = {
  regular: 'Roboto_400Regular',
  medium: 'Roboto_500Medium',
  bold: 'Roboto_700Bold',
  black: 'Roboto_900Black',
} as const;

/** size / lineHeight / family, matching the prototype's usage. */
export const text = {
  /** Section eyebrows, uppercase micro-labels. */
  overline: { fontSize: 11, lineHeight: 14, fontFamily: font.bold, letterSpacing: 1.4 },
  /** Card meta, timestamps, helper copy. */
  caption: { fontSize: 12, lineHeight: 16, fontFamily: font.regular },
  captionStrong: { fontSize: 12, lineHeight: 16, fontFamily: font.medium },
  /** Body copy and list rows. */
  bodySm: { fontSize: 13, lineHeight: 19, fontFamily: font.regular },
  body: { fontSize: 14, lineHeight: 21, fontFamily: font.regular },
  bodyStrong: { fontSize: 14, lineHeight: 21, fontFamily: font.medium },
  /** Card titles, list item titles. */
  subtitle: { fontSize: 15, lineHeight: 21, fontFamily: font.bold },
  /** Screen section headings, button labels. */
  title: { fontSize: 17, lineHeight: 23, fontFamily: font.bold },
  /** Screen titles. */
  headline: { fontSize: 20, lineHeight: 26, fontFamily: font.black },
  /** Hero numbers — payout, net earnings, bandwidth count. */
  display: { fontSize: 25, lineHeight: 30, fontFamily: font.black, letterSpacing: -0.5 },
} as const;

export type TextStyleName = keyof typeof text;
