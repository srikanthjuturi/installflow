/**
 * The AI threshold's first-render fallback.
 *
 * Everything on Rules configuration is served now — `GET /settings/rules`, one
 * row per company in `company_rules` — so this is no longer where any rule is
 * DECLARED. It is the number `useAiThreshold` reports in the tick before that
 * query resolves, so the AI queue's "below threshold" label has something
 * honest to say on first paint rather than flashing a 0.
 *
 * The other four constants that lived here are gone with the mock they fed:
 * `AI_CONFIDENCE_MIN` / `MAX` are served as `aiThresholdMin` / `Max` (the API's
 * `core/rules.LIMITS` is the one declaration, and the CHECK constraint reads
 * the same pair), and `CUSTOMER_WAIT_HOURS` / `ESCALATION_TRIGGER_HOURS` are
 * `company_rules` columns the sweeps actually run on.
 *
 * It stays a constant rather than becoming another served value because a
 * fallback that has to be fetched is not a fallback.
 */
export const AI_CONFIDENCE_THRESHOLD = 70;
