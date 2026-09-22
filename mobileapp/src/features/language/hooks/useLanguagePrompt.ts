import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { AVAILABLE_LANGUAGES } from '@/i18n';
import { useLanguage } from '@/store/language.store';

/** Once per launch, whichever screen asks first. */
let prompted = false;

/**
 * Open the language list by itself, the first time the app is opened on this
 * phone.
 *
 * So that somebody who cannot read English never has to get past an English
 * screen to find the setting. Called by the screens a session can START on —
 * sign-in, an invite link, Home — because an invite link or a signed-in
 * technician updating the app never passes through sign-in at all. The
 * existing installs that update therefore see it once too, on Home.
 *
 * "Nothing chosen yet" is `chosen === null`, and the sheet records a choice
 * however it is left, so this can only ever fire once per phone.
 */
export function useLanguagePrompt(): void {
  const router = useRouter();
  const hydrated = useLanguage((s) => s.hydrated);
  const chosen = useLanguage((s) => s.chosen);

  useEffect(() => {
    if (prompted || !hydrated || chosen !== null || AVAILABLE_LANGUAGES.length < 2) return;
    prompted = true;
    router.push('/language');
  }, [hydrated, chosen, router]);
}
