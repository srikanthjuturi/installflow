import { Stack } from 'expo-router';

/** Proof capture flow. Gestures are disabled — the steps are ordered. */
export default function ProofLayout() {
  return <Stack screenOptions={{ headerShown: false, gestureEnabled: false }} />;
}
