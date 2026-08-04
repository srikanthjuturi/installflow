import { Redirect } from 'expo-router';

/**
 * Boot route. Once the session store lands (step 2) this branches on auth
 * state; for now it drops straight into the invite flow, which is where a
 * technician actually starts — they arrive from an ASM's invite link.
 */
export default function Index() {
  return <Redirect href="/invite" />;
}
