import i18n, { t } from 'i18next';

/**
 * The sentence to show for a failure, in the language the app is in.
 *
 * Most failures a technician reads were written by the SERVER, in English —
 * it knows nothing about the app's language. What it does send, for the ones
 * worth telling apart, is a machine `code`, so that is what gets translated.
 *
 * - **English:** exactly what the app showed before it had languages — the
 *   error's own message, else `fallback`. The server's sentence carries detail
 *   (a date, an amount) that a translation keyed by code cannot.
 * - **Any other language**, first match wins:
 *   1. `errors.code.<CODE>` — a server code, or one of the app's own
 *      (`OFFLINE`, `SESSION_ENDED`, `BAD_RESPONSE`, from `lib/api.ts`);
 *   2. `byStatus[status]` — for the few screens whose server errors carry no
 *      code but whose statuses are unambiguous THERE (sign-in, invite);
 *   3. a 429 — "too many attempts";
 *   4. the server's own English. Specific beats generic when nothing else
 *      fits, and it is still something to show a manager;
 *   5. `fallback`.
 *
 * This decides the LANGUAGE of the sentence, never WHETHER to show one: every
 * call site keeps the guard it had, e.g. `e instanceof ApiError ? errorText(e,
 * fb) : fb`. It reads `code` and `status` off any object because the feature
 * error classes (`JobRefusedError`, `PayoutCodeError`…) carry a code without
 * being `ApiError`s.
 *
 * Call it while rendering, never when the error is caught — a sentence stored
 * at catch time stays in the old language after a switch.
 */
export function errorText(
  error: unknown,
  fallback: string,
  byStatus?: Partial<Record<number, string>>,
): string {
  const { message, code, status } = (error ?? {}) as {
    message?: unknown;
    code?: unknown;
    status?: unknown;
  };
  const own = typeof message === 'string' && message.length > 0 ? message : null;

  if ((i18n.resolvedLanguage ?? i18n.language) === 'en') return own ?? fallback;

  if (typeof code === 'string') {
    const byCode: Record<string, string | undefined> = t('errors.code', { returnObjects: true });
    const translated = byCode[code];
    if (translated) return translated;
  }
  if (typeof status === 'number') {
    const mapped = byStatus?.[status];
    if (mapped) return mapped;
    if (status === 429) return t('errors.tooMany');
  }
  return own ?? fallback;
}
