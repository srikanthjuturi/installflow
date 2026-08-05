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
  /** Footnotes sitting under a card — lock notes, helper lines. */
  textFootnote: palette.neutral[450],
  /** Field labels and instructional body copy on forms. */
  textLabel: palette.neutral[600],
  textInverse: palette.neutral[0],
  textLink: palette.primary[500],

  // ── surfaces ────────────────────────────────────────────────────────────
  surface: palette.neutral[150], // app background
  surfaceRaised: palette.neutral[0], // cards
  surfaceSunken: palette.neutral[100],
  /** Panel sitting ON a white page — grouped detail lists. */
  surfaceSunkenAlt: palette.neutral[50],
  chrome: palette.chrome, // dark header behind status bar
  /** Raised panel sitting ON the dark chrome — the Home online toggle. */
  chromePanel: 'rgba(255,255,255,0.06)',
  /** Tappable control on the dark chrome — the Home bell button. */
  chromeControl: 'rgba(255,255,255,0.08)',
  /** Secondary text on the dark chrome. Blue-tinted, not a neutral grey. */
  textOnChrome: '#8fa0b3',
  /** Tertiary text on chrome — job ids in a dark header. */
  textOnChromeFaint: '#7d8b99',
  /** Pills sitting on the dark chrome need their own, lighter treatment. */
  pillChromeBg: 'rgba(255,255,255,0.1)',
  pillChromeFg: palette.primary[200],
  pillChromeAmberBg: 'rgba(245,180,10,0.14)',
  pillChromeAmberFg: '#f8d78a',
  /** Masked values — present but deliberately unreadable. */
  textMasked: '#b0bac3',
  /** The committed-slot block on the offer screen: warmer than slotBg. */
  slotBlockBg: '#fff8ec',
  slotBlockBorder: '#fbe6bf',
  slotBlockLabel: '#b98a3a',
  /** Border on the tinted "new jobs in your area" banner. */
  bannerBorder: '#d7e6ff',
  /** Unread indicator dot. */
  notificationDot: palette.secondary[400],
  /** Switch track in its off state, on the dark chrome. */
  chromeTrackOff: 'rgba(255,255,255,0.2)',
  cameraBg: palette.neutral[950],
  /** Camera chrome — controls, hints and guides over the live feed. */
  cameraTopControl: 'rgba(255,255,255,0.1)',
  cameraBottomControl: 'rgba(255,255,255,0.08)',
  cameraHint: '#c3cede',
  cameraDim: '#607284',
  cameraGuide: 'rgba(255,255,255,0.7)',
  shutterRing: 'rgba(255,255,255,0.4)',
  /** The geo-lock badge is GREEN — it confirms a check passed, not a warning. */
  geoLockBg: 'rgba(22,163,74,0.9)',
  scanLine: palette.secondary[400],
  /** Scrim behind a bottom sheet. Tinted toward the chrome ink, not pure black. */
  overlay: 'rgba(14,22,34,0.5)',
  /** The drag handle on a bottom sheet. */
  grabber: '#dfe4e9',

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

  // ── verification hero ───────────────────────────────────────────────────
  /** Full-bleed gradient headers on the three AI outcomes. */
  successHero: ['#0f5132', '#16a34a'] as [string, string],
  dangerHero: ['#7a1d1d', '#c81e1e'] as [string, string],
  warnHero: ['#7c4a06', '#d18f16'] as [string, string],
  heroBadge: 'rgba(255,255,255,0.16)',
  /** Blue-tinted well on the chrome hero — the closure screen. */
  heroWellBlue: 'rgba(31,111,235,0.16)',
  /** Outline ring for a step that hasn't happened yet. */
  stepPending: '#d0d7dd',
  successHeroText: '#c7f0d6',
  dangerHeroText: '#f6cccc',
  warnHeroText: '#fbe6bf',
  /** The verifying spinner: an expanding pulse behind a partial ring. */
  verifyPulse: 'rgba(31,111,235,0.25)',
  verifyTrack: 'rgba(255,255,255,0.12)',
  verifyAccent: palette.primary[400],
  verifyStrongText: '#cdd9e6',

  // ── confirmation panel ──────────────────────────────────────────────────
  /** Tinted ground for a passed check. Softer than the success ramp. */
  successSurface: '#eaf7ef',
  successSurfaceBorder: '#c6e9d3',
  /** Placeholder for a capture thumbnail before its image is available. */
  thumbFrom: palette.neutral[800],
  thumbTo: '#455a72',

  // ── penalty panel ───────────────────────────────────────────────────────
  /** Tinted ground for the cancellation cost. Softer than the danger ramp. */
  dangerSurface: '#fdecec',
  dangerSurfaceBorder: '#f3c9c9',
  dangerTextStrong: '#aa3333',
  dangerTextMuted: '#cc9988',

  // ── committed slot — the app's signature emphasis ────────────────────────
  slotFg: palette.secondary[800],
  slotBg: palette.secondary[100],

  // ── availability ────────────────────────────────────────────────────────
  online: palette.success[400],
  offline: palette.neutral[350],
} as const;

export type SemanticColor = typeof color;
