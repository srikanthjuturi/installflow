/**
 * Rule values that more than one screen depends on.
 *
 * These live here rather than in a feature service because two features read
 * the same number: Rules configuration presents the AI threshold as an
 * adjustable 50–95 slider, and the AI review queue uses it to decide what is
 * "below threshold". Declaring it twice let the two drift — moving the slider
 * changed one screen and not the other.
 *
 * When the backend lands this becomes a served value; both consumers already
 * read it from one place, so only this module changes.
 */
export const AI_CONFIDENCE_THRESHOLD = 70;
export const AI_CONFIDENCE_MIN = 50;
export const AI_CONFIDENCE_MAX = 95;

/** Hours of customer silence before manager closure becomes available (§10). */
export const CUSTOMER_WAIT_HOURS = 48;

/** Hours before a confirmed slot at which an unassigned ticket escalates (§7). */
export const ESCALATION_TRIGGER_HOURS = 4;
