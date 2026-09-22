import { Link, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Text } from '@/components/ui';

export default function NotFoundScreen() {
  const { t } = useTranslation();

  return (
    <>
      <Stack.Screen options={{ title: t('notFound.title') }} />
      <View className="flex-1 items-center justify-center bg-neutral-150 px-5">
        <Text className="font-black text-[20px] text-neutral-900">{t('notFound.heading')}</Text>
        <Text className="mt-2 text-center text-[14px] text-neutral-500">
          {t('notFound.body')}
        </Text>
        <Link href="/" className="mt-6 text-[14px] font-medium text-primary-500">
          {t('notFound.link')}
        </Link>
      </View>
    </>
  );
}
