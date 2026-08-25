import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { ErrorState, JobCardSkeleton } from '@/components/feedback';
import { Icon } from '@/components/icons/Icon';
import { ScreenStatusBar, TabHeader } from '@/components/layout';
import { SegmentedControl } from '@/components/ui';
import { MyJobCard } from '@/features/jobs/components/MyJobCard';
import { useMyJobs } from '@/features/jobs/hooks/useJobs';
import { color } from '@/theme/semantic';
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
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScreenStatusBar style="dark" />

      <TabHeader title="My jobs">
        <View style={{ marginBottom: 12 }}>
          <SegmentedControl options={FILTERS} value={filter} onChange={setFilter} />
        </View>
      </TabHeader>

      <ScrollView
        contentContainerStyle={{ paddingTop: 14, paddingHorizontal: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {isPending ? (
          <>
            <JobCardSkeleton />
            <JobCardSkeleton />
          </>
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : data.length === 0 ? (
          // One line, no body copy — the filter name already says everything
          // there is to say about why the list is empty.
          <View style={{ alignItems: 'center', paddingVertical: 60, paddingHorizontal: 24 }}>
            <View
              style={{
                width: 60,
                height: 60,
                borderRadius: 18,
                backgroundColor: color.border,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 14,
              }}
            >
              <Icon name="jobs" size={28} color={color.textMuted} strokeWidth={1.7} />
            </View>
            <Text
              style={{ fontFamily: 'Roboto_700Bold', fontSize: 14.5, color: color.textLabel }}
            >
              {active?.empty ?? 'Nothing here'}
            </Text>
          </View>
        ) : (
          data.map((job) => (
            <MyJobCard key={job.id} job={job} onPress={() => router.push(`/job/${job.id}`)} />
          ))
        )}
      </ScrollView>
    </View>
  );
}
