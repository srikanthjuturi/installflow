import { EmptyState } from '@/components/feedback';
import { Header, Screen } from '@/components/layout';

/** Placeholder — the real Jobs screen lands in its own commit. */
export default function JobsRoute() {
  return (
    <>
      <Header title="Jobs" showBack={false} />
      <Screen>
        <EmptyState title="Not built yet" body="This screen is coming in a later commit." />
      </Screen>
    </>
  );
}
