import { useLocalSearchParams } from 'expo-router';

import { BaseMapScreen } from '@/features/base-location/screens/BaseMapScreen';

/** Full-screen OpenStreetMap pin. Saves, then goes back to where it came from. */
export default function BaseMapRoute() {
  const { onboarding } = useLocalSearchParams<{ onboarding?: string }>();
  return <BaseMapScreen onboarding={onboarding === '1'} />;
}
