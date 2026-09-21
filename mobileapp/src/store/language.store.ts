import { changeLanguage } from 'i18next';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { AVAILABLE_LANGUAGES, deviceLanguage } from '@/i18n';
import type { Language } from '@/i18n/languages';
import { secureStorage } from '@/lib/secureStorage';

interface LanguageState {
  /**
   * The language picked on THIS phone, or null if nobody has picked one yet —
   * which is what opens the picker on its own the first time.
   */
  chosen: Language | null;
  /**
   * What the app is showing: the choice, else the phone's own language when
   * the app speaks it, else English. Derived, so never stored.
   */
  active: Language;
  /** Whether SecureStore has been read yet — see `session.store`. */
  hydrated: boolean;
  choose: (language: Language) => void;
}

/**
 * Which language the app speaks.
 *
 * Client state, so Zustand (hard rule 3). Per DEVICE, and deliberately kept
 * through sign-out: it is a fact about who holds the phone and what they read,
 * not about which account is signed in — the next person to sign in on a
 * Telugu phone should not be dropped back into English.
 *
 * SecureStore rather than plain storage only because it is the one storage
 * this app already has; a language is not a secret.
 */
export const useLanguage = create<LanguageState>()(
  persist(
    (set) => ({
      chosen: null,
      active: 'en',
      hydrated: false,
      choose: (language) => {
        set({ chosen: language });
        apply(language);
      },
    }),
    {
      name: 'reliancegreentech.language',
      version: 1,
      storage: createJSONStorage(() => secureStorage),
      // `active` and `hydrated` are derived, not stored.
      partialize: (s) => ({ chosen: s.chosen }),
    },
  ),
);

/**
 * Switch i18next and tell every component that asked.
 *
 * `changeLanguage` re-renders whatever called `useTranslation()`; `active` is
 * for `ui/Text`, which only needs to know whether the script is Indic and so
 * subscribes to that alone rather than to every translation.
 */
function apply(language: Language) {
  void changeLanguage(language);
  useLanguage.setState({ active: language });
}

/** A saved choice the app can no longer speak falls back to the phone's language. */
function resolve(chosen: Language | null): Language {
  return chosen && AVAILABLE_LANGUAGES.some((l) => l.code === chosen) ? chosen : deviceLanguage();
}

/**
 * Apply the saved language once storage has been read, then open the gate.
 *
 * Wired from OUT here rather than inside `create()`, for the reason
 * `session.store` spells out: referencing the store inside its own config is a
 * temporal-dead-zone trap, and the resulting rejection is swallowed.
 *
 * Applied on EVERY read, not just the first: if the failsafe below opened the
 * gate on the phone's language and the real read lands later, the saved
 * choice still wins.
 */
function onStorageRead() {
  apply(resolve(useLanguage.getState().chosen));
  if (!useLanguage.getState().hydrated) useLanguage.setState({ hydrated: true });
}

useLanguage.persist.onFinishHydration(onStorageRead);
// Covers the race where rehydration already finished before this line ran.
if (useLanguage.persist.hasHydrated()) onStorageRead();

/**
 * Failsafe. A hung Keychain read must not hold the splash forever; the
 * phone's language is the right answer for a fresh install, which is the case
 * this would otherwise strand.
 */
const HYDRATION_TIMEOUT_MS = 3000;
setTimeout(() => {
  if (!useLanguage.getState().hydrated) {
    console.warn(
      `[language] storage did not respond in ${HYDRATION_TIMEOUT_MS}ms — using the phone's language`,
    );
    apply(deviceLanguage());
    useLanguage.setState({ hydrated: true });
  }
}, HYDRATION_TIMEOUT_MS);
