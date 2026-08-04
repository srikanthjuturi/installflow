import { Tabs } from 'expo-router';

import { Icon, type IconName } from '@/components/icons/Icon';
import { color } from '@/theme/semantic';

/** Home · Jobs · Earnings · Profile — the four tabs from the prototype. */
const TAB_ICON: Record<string, IconName> = {
  index: 'home',
  jobs: 'jobs',
  earnings: 'wallet',
  profile: 'user',
};

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: color.actionBg,
        tabBarInactiveTintColor: color.textMuted,
        tabBarStyle: {
          backgroundColor: color.surfaceRaised,
          borderTopColor: color.border,
          height: 64,
          paddingTop: 6,
          paddingBottom: 8,
        },
        tabBarLabelStyle: { fontFamily: 'Roboto_500Medium', fontSize: 11 },
        tabBarIcon: ({ color: tint }) => (
          <Icon name={TAB_ICON[route.name] ?? 'home'} size={23} color={tint} />
        ),
      })}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="jobs" options={{ title: 'Jobs' }} />
      <Tabs.Screen name="earnings" options={{ title: 'Earnings' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
