import { palette } from './tokens';

/**
 * Semantic colour roles — THIS is what screens consume.
 *
 * Screens reference roles (`color.textPrimary`), never ramp positions
 * (`palette.neutral[900]`). That indirection is what lets us re-skin to a
 * different brand by editing `tokens.js` alone.
 *
 * Use these when a NativeWind class isn't possible: StatusBar, Reanimated,
 * react-native-svg icons, camera overlays.
 */
export const color = {
  // ── text ────────────────────────────────────────────────────────────────
  textPrimary: palette.neutral[900],
  textSecondary: palette.neutral[500],
  textMuted: palette.neutral[400],
  textInverse: palette.neutral[0],
  textLink: palette.primary[500],

  // ── surfaces ────────────────────────────────────────────────────────────
  surface: palette.neutral[150], // app background
  surfaceRaised: palette.neutral[0], // cards
  surfaceSunken: palette.neutral[100],
  chrome: palette.chrome, // dark header behind status bar
  /** Raised panel sitting ON the dark chrome — the Home online toggle. */
  chromePanel: 'rgba(255,255,255,0.06)',
  cameraBg: palette.neutral[950],
  overlay: 'rgba(11,15,22,0.72)',

  // ── lines ───────────────────────────────────────────────────────────────
  border: palette.neutral[200],
  borderStrong: palette.neutral[350],
  borderFocus: palette.primary[500],

  // ── actions ─────────────────────────────────────────────────────────────
  actionBg: palette.primary[500],
  actionBgPress: palette.primary[600],
  actionBgDisabled: palette.neutral[200],
  actionFg: palette.neutral[0],
  actionFgDisabled: palette.neutral[400],

  // ── job status ──────────────────────────────────────────────────────────
  // One place. Every StatusBadge in the app reads from here.
  statusUpcoming: { fg: palette.primary[500], bg: palette.primary[50] },
  statusStartingSoon: { fg: palette.secondary[600], bg: palette.secondary[100] },
  statusInProgress: { fg: palette.primary[500], bg: palette.primary[50] },
  statusCompleted: { fg: palette.success[500], bg: palette.success[100] },
  statusCancelled: { fg: palette.danger[500], bg: palette.danger[100] },

  // ── money ───────────────────────────────────────────────────────────────
  credit: palette.success[500],
  debit: palette.danger[500],
  bonus: palette.secondary[600],

  // ── committed slot — the app's signature emphasis ────────────────────────
  slotFg: palette.secondary[800],
  slotBg: palette.secondary[100],

  // ── availability ────────────────────────────────────────────────────────
  online: palette.success[400],
  offline: palette.neutral[350],
} as const;

export type SemanticColor = typeof color;
