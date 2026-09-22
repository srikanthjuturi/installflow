import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { Sheet, Text } from '@/components/ui';
import { AVAILABLE_LANGUAGES } from '@/i18n';
import type { Language } from '@/i18n/languages';
import { useLanguage } from '@/store/language.store';
import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';

/**
 * Choose the app's language.
 *
 * One list, reached three ways: it opens by itself the first time the app is
 * opened (`useLanguagePrompt`), from the 🌐 button on the sign-in screen, and
 * from Profile → Language. A root route like `avatar-options`, so it works
 * before anybody has signed in.
 *
 * Each language is written in its own script — somebody who reads Telugu is
 * looking for తెలుగు, not for the English word — with the English name under
 * it for whoever is helping them. A tap switches the whole app at once and
 * closes the sheet; there is no Save, because the change is the confirmation.
 */
export function LanguageSheet() {
  const router = useRouter();
  const { t } = useTranslation();
  const active = useLanguage((s) => s.active);
  const choose = useLanguage((s) => s.choose);

  // Leaving without a tap — the scrim, the back button — keeps the language
  // on screen and counts as choosing it, so the first-launch prompt does not
  // open again. On unmount, because that is the one place every way out of a
  // route passes through.
  useEffect(
    () => () => {
      const { chosen, active: showing } = useLanguage.getState();
      if (chosen === null) useLanguage.getState().choose(showing);
    },
    [],
  );

  const pick = (code: Language) => {
    choose(code);
    router.back();
  };

  return (
    <Sheet onDismiss={() => router.back()}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Icon name="globe" size={22} color={color.textLabel} strokeWidth={1.7} />
        <Text style={{ fontFamily: 'Roboto_900Black', fontSize: 20, color: color.textPrimary }}>
          {t('language.title')}
        </Text>
      </View>

      <View
        accessibilityRole="radiogroup"
        style={{
          backgroundColor: color.surfaceSunkenAlt,
          borderRadius: 14,
          overflow: 'hidden',
        }}
      >
        {AVAILABLE_LANGUAGES.map((language, i) => {
          const selected = language.code === active;
          const translated = language.code !== 'en';
          return (
            <Pressable
              key={language.code}
              onPress={() => pick(language.code)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={
                translated ? `${language.nativeName}, ${language.englishName}` : language.nativeName
              }
            >
              {({ pressed }) => (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingVertical: 12,
                    paddingHorizontal: 16,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: palette.neutral[200],
                    backgroundColor: pressed ? color.surfaceSunken : 'transparent',
                  }}
                >
                  <View style={{ flex: 1 }}>
                    {/* A line height every script fits in whatever language the
                        app is in: these names are drawn in five scripts at
                        once, and `ui/Text` only relaxes line heights for the
                        ACTIVE one. */}
                    <Text
                      style={{
                        fontFamily: selected ? 'Roboto_700Bold' : 'Roboto_500Medium',
                        fontSize: 16,
                        lineHeight: 26,
                        color: color.textPrimary,
                      }}
                    >
                      {language.nativeName}
                    </Text>
                    {translated ? (
                      <Text
                        style={{
                          fontFamily: 'Roboto_400Regular',
                          fontSize: 12.5,
                          lineHeight: 17,
                          color: color.textMuted,
                        }}
                      >
                        {language.englishName}
                      </Text>
                    ) : null}
                  </View>
                  {selected ? <Icon name="check" size={20} color={color.actionBg} /> : null}
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}
