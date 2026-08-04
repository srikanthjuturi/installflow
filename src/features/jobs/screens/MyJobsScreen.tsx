import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { EmptyState, ErrorState, JobCardSkeleton } from '@/components/feedback';
import { Header, Screen } from '@/components/layout';
import { SegmentedControl } from '@/components/ui';
import { JobCard } from '@/features/jobs/components/JobCard';
import { useMyJobs } from '@/features/jobs/hooks/useJobs';
import type { JobStatus } from '@/types/domain';

type Filter = Extract<JobStatus, 'upcoming' | 'inprogress' | 'completed'>;

const FILTERS: { value: Filter; label: string; empty: string }[] = [
  { value: 'upcoming', label: 'Upcoming', empty: 'No upcoming jobs' },
  { value: 'inprogress', label: 'In progress', empty: 'Nothing in progress' },
  { value: 'completed', label: 'Completed', empty: 'No completed jobs yet' },
];

/** Screen 6 — everything this technician has accepted, by stage. */
export function MyJobsScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('upcoming');

  const { data, isPending, isError, refetch } = useMyJobs(filter);
  const active = FILTERS.find((f) => f.value === filter);

  return (
    <>
      <Header title="My jobs" showBack={false} />

      <Screen>
        <View style={{ marginBottom: 16 }}>
          <SegmentedControl options={FILTERS} value={filter} onChange={setFilter} />
        </View>

        {isPending ? (
          <>
            <JobCardSkeleton />
            <JobCardSkeleton />
          </>
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : data.length === 0 ? (
          // Copy is per-filter: "No upcoming jobs" reads very differently from
          // "No completed jobs yet" to someone checking their day.
          <EmptyState title={active?.empty ?? 'Nothing here'} />
        ) : (
          data.map((job) => (
            <JobCard key={job.id} job={job} onPress={() => router.push(`/job/${job.id}`)} />
          ))
        )}
      </Screen>
    </>
  );
}
