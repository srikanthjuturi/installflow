import { EmptyState } from '@/components/feedback';
import { Header, Screen } from '@/components/layout';

/** Placeholder — the real Profile screen lands in its own commit. */
export default function ProfileRoute() {
  return (
    <>
      <Header title="Profile" showBack={false} />
      <Screen>
        <EmptyState title="Not built yet" body="This screen is coming in a later commit." />
      </Screen>
    </>
  );
}
