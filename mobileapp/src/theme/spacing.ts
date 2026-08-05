/** Radii and spacing extracted from the approved prototype. */

/** The prototype uses exactly these corner radii — nothing else. */
export const radius = {
  sm: 8,
  md: 12, // most cards, inputs
  lg: 14, // grouped list containers
  xl: 16, // sheets, primary buttons
  '2xl': 18, // hero cards
  full: 999, // chips, pills, toggles
} as const;

/** 4pt grid. Screen gutter is 20 throughout the prototype. */
export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20, // ◄ screen gutter
  6: 24,
  7: 28,
  8: 32,
  10: 40,
  12: 48,
} as const;

/** Fixed chrome heights from the prototype's 392×812 frame. */
export const layout = {
  screenGutter: 20,
  headerHeight: 56,
  tabBarHeight: 64,
  shutterSize: 72,
} as const;
