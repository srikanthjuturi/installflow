import type en from './locales/en.json';

/**
 * Types every `t('…')` key from the English file, so a mistyped or deleted key
 * fails `npm run typecheck` instead of printing the raw key on somebody's phone.
 *
 * `enableSelector: false` keeps the plain string keys this app uses —
 * `t('jobs.pool.title')`. i18next has said its selector API will become the
 * default; pinning it here means an upgrade cannot quietly change which syntax
 * type-checks.
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
    enableSelector: false;
  }
}
