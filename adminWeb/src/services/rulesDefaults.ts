/**
 * First-render fallbacks, and nothing else.
 *
 * Everything on Rules configuration is served now — `GET /settings/rules`, one
 * row per company in `company_rules` — so this is no longer where any rule is
 * DECLARED. These are the numbers a screen reports in the tick before that
 * query resolves, so a label has something honest to say on first paint rather
 * than flashing a 0 or a blank.
 *
 * `AI_CONFIDENCE_MIN` / `MAX` went with the mock they fed: they are served as
 * `aiThresholdMin` / `Max` (the API's `core/rules.LIMITS` is the one
 * declaration, and the CHECK constraint reads the same pair). So did
 * `CUSTOMER_WAIT_HOURS`, whose two screens read the value the server sends
 * beside the count it was measured with.
 *
 * They stay constants rather than becoming served values because a fallback
 * that has to be fetched is not a fallback.
 */
export const AI_CONFIDENCE_THRESHOLD = 70;

/**
 * The escalation window's first-render fallback — `escalate_hours_before_slot`.
 *
 * This is deliberately NOT a re-declaration of the rule. It was removed once,
 * with the mock it fed, and what brought it back is the failure that follows
 * from having no fallback at all: the default moved 4 → 1, six hard-coded "4h"
 * and "1 hour" strings across the queue, its page header and two dashboard
 * cards went on quoting whatever they were last edited to, and the screenshots
 * in the client deck still say four hours over a queue selected at one.
 *
 * Every one of those six now reads `escalationTriggerHours` off the rules
 * query. This is only what they say in the tick before it resolves — and it
 * tracks `rules.DEFAULTS["escalate_hours_before_slot"]`, which is the number a
 * company that has never opened Rules configuration is actually running.
 */
export const ESCALATION_TRIGGER_HOURS = 1;
