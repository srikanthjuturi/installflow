import type { ComponentProps } from 'react';
import { Text as NativeText, StyleSheet, type TextStyle } from 'react-native';

import { INDIC_LANGUAGES } from '@/i18n/languages';
import { useLanguage } from '@/store/language.store';
import { INDIC_MIN_LINE_HEIGHT } from '@/theme/typography';

export type TextProps = ComponentProps<typeof NativeText>;

/** React Native's own default, for a style that names no size. */
const DEFAULT_FONT_SIZE = 14;

/**
 * The app's one `Text`: React Native's, adjusted for Indian scripts.
 *
 * In English it IS React Native's Text — same props, same styles, nothing
 * added. In Hindi, Telugu, Kannada and Tamil it changes two things, and only on
 * the element that declared them:
 *
 * - **letterSpacing becomes 0.** Tracking is a Latin idea: it breaks the line
 *   that joins Hindi letters and spaces the other scripts unevenly.
 * - **A tight lineHeight is raised** to `INDIC_MIN_LINE_HEIGHT` × fontSize.
 *   These scripts stack vowel signs above a letter and conjuncts below it, and
 *   at the ratios some screens use (15.5 on 19) Android clips them. A
 *   lineHeight the element did not declare is never ADDED, so nested spans — a
 *   bold name inside a sentence, a <Trans> link — keep inheriting their
 *   parent's.
 *
 * Every screen imports this rather than React Native's, and lint enforces it:
 * React 19 dropped `defaultProps` for function components, so a wrapper is the
 * only place left that can change how all text renders.
 *
 * It subscribes to whether the script is Indic, not to the language, so
 * switching between two Indic languages re-renders nothing here — the words
 * change because the parent re-rendered with `t()`.
 */
export function Text({ style, ...rest }: TextProps) {
  const indic = useLanguage((s) => INDIC_LANGUAGES.has(s.active));
  if (!indic) return <NativeText style={style} {...rest} />;

  const flat: TextStyle = StyleSheet.flatten(style) ?? {};
  const fix: TextStyle = {};
  if (flat.letterSpacing) fix.letterSpacing = 0;
  if (typeof flat.lineHeight === 'number') {
    const min = Math.ceil((flat.fontSize ?? DEFAULT_FONT_SIZE) * INDIC_MIN_LINE_HEIGHT);
    if (flat.lineHeight < min) fix.lineHeight = min;
  }
  return <NativeText style={Object.keys(fix).length > 0 ? [style, fix] : style} {...rest} />;
}
