import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { Text } from '@/components/ui';
import { AVAILABLE_LANGUAGES } from '@/i18n';
import { LANGUAGES } from '@/i18n/languages';
import { useLanguage } from '@/store/language.store';
import { color } from '@/theme/semantic';

/**
 * 🌐 and the language on screen, in its own script — the way to the language
 * list before anybody has signed in.
 *
 * On the sign-in screen because that is the first thing somebody who cannot
 * read English meets, and the first-launch prompt has usually been dismissed
 * by then. Draws nothing while only English exists: a picker with one choice
 * is not a choice.
 */
export function LanguagePill() {
  const router = useRouter();
  const { t } = useTranslation();
  const active = useLanguage((s) => s.active);

  if (AVAILABLE_LANGUAGES.length < 2) return null;
  const name = LANGUAGES.find((l) => l.code === active)?.nativeName ?? active;

  return (
    <Pressable
      onPress={() => router.push('/language')}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`${t('language.title')}: ${name}`}
    >
      {({ pressed }) => (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            height: 36,
            paddingHorizontal: 12,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: color.border,
            backgroundColor: pressed ? color.surfaceSunken : color.surfaceRaised,
          }}
        >
          <Icon name="globe" size={16} color={color.textLabel} strokeWidth={1.7} />
          <Text style={{ fontFamily: 'Roboto_500Medium', fontSize: 13, color: color.textPrimary }}>
            {name}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
