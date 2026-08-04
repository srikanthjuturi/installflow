import { useRouter } from 'expo-router';
import { Text } from 'react-native';

import { EmptyState, ErrorState, JobCardSkeleton } from '@/components/feedback';
import { Header, Screen } from '@/components/layout';
import { JobCard } from '@/features/jobs/components/JobCard';
import { usePool } from '@/features/jobs/hooks/useJobs';
import { color } from '@/theme/semantic';

/**
 * Screen 4 — Open job pool.
 *
 * Every job here already has a slot the customer confirmed, so there is
 * nothing to negotiate — the only decision is whether to commit. Assignment is
 * first-accept-wins, which is why the subtitle says so up front: a technician
 * who reads a card slowly can lose it, and that must not feel like a bug.
 */
export function PoolScreen() {
  const router = useRouter();
  const { data, isPending, isError, refetch } = usePool();

  return (
    <>
      <Header
        title="Open job pool"
        subtitle="Confirmed slots matching your category & pincodes. First to accept wins — customer details stay masked until you accept."
      />

      <Screen>
        {isPending ? (
          <>
            <JobCardSkeleton />
            <JobCardSkeleton />
            <JobCardSkeleton />
          </>
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : data.length === 0 ? (
          <EmptyState title="Pool is empty" body="You've taken every open job nearby." />
        ) : (
          <>
            <Text
              style={{
                fontFamily: 'Roboto_500Medium',
                fontSize: 12,
                color: color.textMuted,
                marginBottom: 12,
              }}
            >
              {data.length} {data.length === 1 ? 'job' : 'jobs'} available
            </Text>

            {data.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                variant="pool"
                onPress={() => router.push(`/pool/${job.id}`)}
              />
            ))}
          </>
        )}
      </Screen>
    </>
  );
}
