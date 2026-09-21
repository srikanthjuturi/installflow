import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Icon, type IconName } from '@/components/icons/Icon';
import { useButtonNavInset } from '@/hooks/useButtonNavInset';
import { color } from '@/theme/semantic';

/** Home · Jobs · Earnings · Profile — the four tabs from the prototype. */
const TAB_ICON: Record<string, IconName> = {
  index: 'home',
  jobs: 'jobs',
  earnings: 'wallet',
  profile: 'user',
};

export default function TabsLayout() {
  // A fixed height here REPLACES the library's own `insets.bottom` padding, so
  // the room for Android's ◁ ○ □ bar has to be added back by hand. Only that
  // bar's: gesture phones and iPhones keep the 64 / 8 they were designed at.
  const navInset = useButtonNavInset();
  const { t } = useTranslation();

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: color.actionBg,
        tabBarInactiveTintColor: color.textMuted,
        tabBarStyle: {
          backgroundColor: color.surfaceRaised,
          borderTopColor: color.border,
          height: 64 + navInset,
          paddingTop: 6,
          paddingBottom: 8 + navInset,
        },
        tabBarLabelStyle: { fontFamily: 'Roboto_500Medium', fontSize: 11 },
        tabBarIcon: ({ color: tint }) => (
          <Icon name={TAB_ICON[route.name] ?? 'home'} size={23} color={tint} />
        ),
      })}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.home') }} />
      <Tabs.Screen name="jobs" options={{ title: t('tabs.jobs') }} />
      <Tabs.Screen name="earnings" options={{ title: t('tabs.earnings') }} />
      <Tabs.Screen name="profile" options={{ title: t('tabs.profile') }} />
    </Tabs>
  );
}
