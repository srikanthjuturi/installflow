import { Stack } from 'expo-router';

/**
 * Authenticated area. The auth guard lands here once the session store exists;
 * for now it's a plain stack so the tab shell and the job routes can nest.
 */
export default function AppLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
