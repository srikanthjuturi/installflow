import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Skeleton } from '@/components/feedback';
import { Text } from '@/components/ui';
import { usePartsAddress } from '@/features/parts-address/hooks/usePartsAddress';
import { formatPartsAddress } from '@/features/parts-address/lib/summary';
import { color } from '@/theme/semantic';

/**
 * "Parts will be sent to: …" with an Edit link — shown on the request screen
 * before the technician submits. Never blocks submitting: if the address cannot
 * be read it simply says nothing, and the server decides where the part goes.
 */
export function PartsDestination() {
  const { t } = useTranslation();
  const router = useRouter();
  const query = usePartsAddress();

  if (query.isPending) return <Skeleton width="100%" height={56} rounded={13} />;
  if (query.isError) return null;

  const address = query.data;

  return (
    <View
      style={{
        backgroundColor: color.surfaceSunken,
        borderRadius: 14,
        paddingVertical: 12,
        paddingHorizontal: 15,
        marginBottom: 14,
      }}
    >
      <Text
        style={{
          fontFamily: 'Roboto_400Regular',
          fontSize: 13,
          lineHeight: 19,
          color: color.textLabel,
        }}
      >
        {address
          ? t('partsAddress.sendTo', { address: formatPartsAddress(address) })
          : t('partsAddress.sendToBase')}
      </Text>
      <Pressable
        onPress={() => router.push('/parts-address')}
        accessibilityRole="link"
        accessibilityLabel={t('partsAddress.edit')}
        hitSlop={8}
      >
        <Text
          style={{
            fontFamily: 'Roboto_700Bold',
            fontSize: 13,
            color: color.textLink,
            marginTop: 6,
          }}
        >
          {t('partsAddress.edit')}
        </Text>
      </Pressable>
    </View>
  );
}
