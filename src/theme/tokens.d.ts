/** Type surface for `tokens.js` — the values live there, in plain CJS, so that
 *  `tailwind.config.js` (Node) and app code (TypeScript) share one source. */

export type RampStep = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950;
export type Ramp = Record<RampStep, string>;

/** Neutral adds 0 (white) plus half-steps 150 and 350 — see tokens.js. */
export type NeutralStep = 0 | 50 | 100 | 150 | 200 | 300 | 350 | 400 | 500 | 600 | 700 | 800 | 900 | 950;
export type NeutralRamp = Record<NeutralStep, string>;

export declare const palette: {
  primary: Ramp;
  secondary: Ramp;
  success: Ramp;
  danger: Ramp;
  neutral: NeutralRamp;
  chrome: string;
};
