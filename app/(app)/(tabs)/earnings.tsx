import { EmptyState } from '@/components/feedback';
import { Header, Screen } from '@/components/layout';

/** Placeholder — the real Earnings screen lands in its own commit. */
export default function EarningsRoute() {
  return (
    <>
      <Header title="Earnings" showBack={false} />
      <Screen>
        <EmptyState title="Not built yet" body="This screen is coming in a later commit." />
      </Screen>
    </>
  );
}
