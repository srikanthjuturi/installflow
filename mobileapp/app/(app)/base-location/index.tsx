import { useLocalSearchParams } from 'expo-router';

import { BaseLocationScreen } from '@/features/base-location/screens/BaseLocationScreen';

/** Profile → Base location, the Home card, and the last onboarding step (?onboarding=1). */
export default function BaseLocationRoute() {
  const { onboarding } = useLocalSearchParams<{ onboarding?: string }>();
  return <BaseLocationScreen onboarding={onboarding === '1'} />;
}
