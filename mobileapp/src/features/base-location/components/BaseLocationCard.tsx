import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { Text } from '@/components/ui';
import { color } from '@/theme/semantic';

/**
 * Home's nudge to set a base location, drawn like the pool banner beside it.
 *
 * Amber, not red: this is "needs doing", not an error — nothing is blocked,
 * jobs just pay no travel allowance until it is set. The caller decides WHEN
 * to show it (`needsBaseLocation(me)`); this only draws it.
 */
export function BaseLocationCard() {
  const router = useRouter();
  const { t } = useTranslation();

  return (
    <Pressable
      onPress={() => router.push('/base-location')}
      accessibilityRole="button"
      accessibilityLabel={t('baseLocation.home.title')}
    >
      {({ pressed }) => (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            backgroundColor: color.surfaceRaised,
            borderWidth: 1,
            borderColor: pressed ? color.statusStartingSoon.fg : color.slotBlockBorder,
            borderRadius: 16,
            padding: 14,
            marginBottom: 16,
          }}
        >
          <View
            style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              backgroundColor: color.statusStartingSoon.bg,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="home" size={22} color={color.statusStartingSoon.fg} strokeWidth={1.7} />
          </View>

          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontFamily: 'Roboto_700Bold',
                fontSize: 14.5,
                color: color.textPrimary,
              }}
            >
              {t('baseLocation.home.title')}
            </Text>
            <Text
              style={{
                fontFamily: 'Roboto_400Regular',
                fontSize: 12.5,
                color: color.textSecondary,
              }}
            >
              {t('baseLocation.home.body')}
            </Text>
          </View>

          <Icon name="chevronRight" size={20} color={color.textMuted} />
        </View>
      )}
    </Pressable>
  );
}
