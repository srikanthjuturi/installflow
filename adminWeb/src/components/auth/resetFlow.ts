/**
 * The shape of the password-reset flow, kept out of the component that draws it
 * so a fast-refresh boundary is not shared between a constant and a component.
 * Same split as `portalNav.ts` beside `PortalNav.tsx`.
 */

/** The three steps, in order. The order IS the flow. */
export const RESET_STEPS = ["email", "code", "password"] as const;

export type ResetStep = (typeof RESET_STEPS)[number];

/** For assistive tech, which reads the step's name rather than seeing it. */
export const RESET_STEP_LABELS: Record<ResetStep, string> = {
  email: "Your email",
  code: "The code we sent",
  password: "A new password",
};
