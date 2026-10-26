// Initialises i18n for every test — `metresLabel` and anything else that
// calls `t()` would otherwise throw with no i18next instance running.
// `src/i18n/index.ts` already guards expo-localization behind
// `requireOptionalNativeModule`, so it runs fine with no native module and
// falls back to English, which is what every test wants.
import '@/i18n';
