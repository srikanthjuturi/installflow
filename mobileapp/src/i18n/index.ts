// FIRST, before i18next loads. Hermes has no Intl.PluralRules, and i18next uses
// it to choose between "1 job" and "2 jobs" — without it every language would
// get English's rule, and Hindi and Kannada treat 0 differently.
import 'intl-pluralrules';

import { requireOptionalNativeModule } from 'expo';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { LANGUAGES, type Language } from './languages';
import en from './locales/en.json';
import hi from './locales/hi.json';

/**
 * Every language that has a translation file. A language reaches the picker by
 * being registered here; `LANGUAGES` only fixes its name and its order.
 */
export const resources = {
  en: { translation: en },
  hi: { translation: hi },
} as const;

export const AVAILABLE_LANGUAGES = LANGUAGES.filter((l) => l.code in resources);

type LocalizationModule = typeof import('expo-localization');

/**
 * Loaded only when its native half is in the build. A dev client built before
 * expo-localization was added has no native module, and the package throws at
 * IMPORT time without one, so a static import would crash those builds on
 * launch. Same guard as `lib/analytics/clarity.ts`.
 */
const Localization: LocalizationModule | null = requireOptionalNativeModule('ExpoLocalization')
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('expo-localization') as LocalizationModule)
  : null;

/**
 * The first of the phone's own languages that the app speaks, else English.
 *
 * Taken in the phone's order, so somebody whose phone lists English before
 * Telugu gets English — that order is theirs. Only a default: once a language
 * has been picked in the app, the saved choice wins.
 */
export function deviceLanguage(): Language {
  for (const locale of Localization?.getLocales() ?? []) {
    const match = AVAILABLE_LANGUAGES.find((l) => l.code === locale.languageCode);
    if (match) return match.code;
  }
  return 'en';
}

// i18next's own setup idiom. The named export `use` would read as React's `use`
// hook to the hooks linter, so the member form stays.
// eslint-disable-next-line import/no-named-as-default-member
void i18n.use(initReactI18next).init({
  resources,
  // Replaced before the first screen draws: `language.store` applies the saved
  // choice, or the phone's language, while the splash is still up.
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: AVAILABLE_LANGUAGES.map((l) => l.code),
  // Every file is bundled, so there is nothing to wait for. Initialising
  // synchronously means `t` works from the first module that imports this.
  initAsync: false,
  // A missing or empty translation shows the English, never a blank.
  returnEmptyString: false,
  returnNull: false,
  // React escapes what it renders already; doing it here too would print `&amp;`.
  interpolation: { escapeValue: false },
  react: {
    // Nothing loads asynchronously, so there is nothing to suspend on.
    useSuspense: false,
    // The default turns <br/>, <strong>… inside a translation into DOM
    // elements, which React Native cannot render. Our <Trans> tags are named
    // components instead.
    transSupportBasicHtmlNodes: false,
  },
});

export default i18n;
