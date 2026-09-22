import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, View } from 'react-native';

import { ErrorState, JobCardSkeleton } from '@/components/feedback';
import { Icon } from '@/components/icons/Icon';
import { ScreenStatusBar, TabHeader } from '@/components/layout';
import { SegmentedControl, Text } from '@/components/ui';
import { MyJobCard } from '@/features/jobs/components/MyJobCard';
import { useMyJobs } from '@/features/jobs/hooks/useJobs';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { color } from '@/theme/semantic';
import type { JobStatus } from '@/types/domain';

type Filter = Extract<JobStatus, 'upcoming' | 'inprogress' | 'completed'>;

const FILTERS = [
  { value: 'upcoming', label: 'jobs.status.upcoming', empty: 'jobs.myJobs.empty.upcoming' },
  { value: 'inprogress', label: 'jobs.status.inProgress', empty: 'jobs.myJobs.empty.inprogress' },
  { value: 'completed', label: 'jobs.status.completed', empty: 'jobs.myJobs.empty.completed' },
] as const satisfies readonly { value: Filter; label: string; empty: string }[];

/** Screen 6 — everything this technician has accepted, by stage. */
export function MyJobsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>('upcoming');

  const { data, isPending, isError, refetch } = useMyJobs(filter);
  const active = FILTERS.find((f) => f.value === filter);
  // The tab a technician checks after a customer confirms or a manager moves a
  // job. The socket usually beats them to it; this is for when it has not.
  const pull = usePullToRefresh(refetch);

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScreenStatusBar style="dark" />

      <TabHeader title={t('jobs.myJobs.title')}>
        <View style={{ marginBottom: 12 }}>
          <SegmentedControl
            options={FILTERS.map((f) => ({ value: f.value, label: t(f.label) }))}
            value={filter}
            onChange={setFilter}
          />
        </View>
      </TabHeader>

      <ScrollView
        contentContainerStyle={{ paddingTop: 14, paddingHorizontal: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl {...pull} />}
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
              {t(active?.empty ?? 'jobs.myJobs.empty.none')}
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
