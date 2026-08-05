/**
 * SINGLE SOURCE OF TRUTH for colour.
 *
 * Consumed by BOTH `tailwind.config.js` (Node/CJS) and app code (TypeScript,
 * via `tokens.d.ts`). Never redeclare a colour anywhere else.
 *
 * Values marked ◄ are extracted verbatim from the approved prototype
 * (RequirementDocs/Technician Field App.html). The rest complete each ramp.
 *
 * Rule: every chromatic role puts its brand colour at 500.
 *       Lighter = 50→400, darker = 600→950. Opacity comes free: `bg-primary-500/20`.
 *
 * Screens must NOT import this file — import `semantic.ts` or use a
 * NativeWind class. Enforced by the no-hex ESLint rule.
 */

/** Actions, links, active tab, accept. */
const primary = {
  50: '#f5f9ff', // ◄ tint background
  75: '#eef4ff', // ◄ chip / banner tint
  100: '#e4efff', // ◄ selected card background
  150: '#d6e4fb', // ◄ chip control (remove button)
  200: '#cfe0fb', // ◄ chip border — real prototype value, was interpolated
  300: '#9cc2ff',
  400: '#4d92ff', // ◄ camera "Next"
  500: '#1f6feb', // ◄ ★ ACTION BLUE
  600: '#1a5fcc', // ◄ pressed
  700: '#164ea6',
  800: '#133f85',
  900: '#12356e',
  950: '#0c2247',
};

/** Committed slot, starting-soon, ASM escalation, reassignment bonus. */
const secondary = {
  50: '#fffbeb',
  100: '#fef3c7', // ◄ amber tint background
  200: '#fde68a',
  300: '#f7cd52',
  400: '#f5b40a', // ◄ CTA amber
  500: '#d18f16', // ◄ ★ COMMITTED SLOT
  600: '#b45309', // ◄ amber text / icon
  700: '#92400e',
  800: '#7c4a06', // ◄ deep amber text
  900: '#5c3703',
  950: '#3d2402',
};

/** Completed, earnings credit, online. */
const success = {
  50: '#f0fdf4',
  100: '#dcfce7', // ◄ success tint
  200: '#bbf7d0',
  300: '#86efac',
  400: '#16a34a', // ◄ online toggle
  500: '#15803d', // ◄ ★ COMPLETED / CREDIT
  600: '#11692f',
  700: '#0e5427',
  800: '#0c4321',
  900: '#0a371c',
  950: '#041f0f',
};

/** Penalties, cancellation, AI mismatch. */
const danger = {
  50: '#fef2f2',
  100: '#fee2e2', // ◄ danger tint
  200: '#fecaca',
  300: '#f79f9f',
  400: '#ea4d4d',
  500: '#c81e1e', // ◄ ★ PENALTY / CANCEL
  600: '#a81818',
  700: '#8a1515',
  800: '#711414',
  900: '#5c1313',
  950: '#330808',
};

/**
 * Text, borders, surfaces, chrome.
 *
 * Two deliberate deviations from a standard ramp, both to preserve the
 * approved design exactly:
 *   - Half-steps 150 and 350 exist because the app surface (#eef1f3) and the
 *     switch-off track (#cdd6de) fall between standard stops.
 *   - The "brand at 500" rule does not apply — a grey ramp runs light→dark,
 *     so ink sits at 900.
 */
const neutral = {
  0: '#ffffff', // ◄ card
  50: '#f6f8fa', // ◄
  100: '#f1f4f6', // ◄
  150: '#eef1f3', // ◄ app surface
  200: '#e4e8ec', // ◄ default border
  300: '#d5dde4', // ◄
  350: '#cdd6de', // ◄ switch track (off)
  400: '#9aa6b1', // ◄ muted / inactive tab
  450: '#8894a0', // ◄ footnote text (lock note, helper lines)
  500: '#7a8794', // ◄ secondary text
  600: '#5a6772', // ◄
  700: '#48555f', // ◄
  800: '#2b3742', // ◄
  900: '#141b22', // ◄ INK — primary text
  950: '#0b0f16', // ◄ camera chrome
};

/**
 * Structural, not a ramp position: the dark device chrome behind the status
 * bar on Home / Earnings / Profile / Offer / Detail.
 */
const chrome = '#0e1622'; // ◄

const palette = { primary, secondary, success, danger, neutral, chrome };

module.exports = { palette };
