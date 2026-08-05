import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ScrollView, Text, View } from 'react-native';

import { ErrorState, JobCardSkeleton } from '@/components/feedback';
import { TitleBar } from '@/components/layout';
import { PoolJobCard } from '@/features/jobs/components/PoolJobCard';
import { usePool } from '@/features/jobs/hooks/useJobs';
import { color } from '@/theme/semantic';

/**
 * Screen 4 — Open job pool.
 *
 * Every job here already carries a customer-confirmed slot, so there is
 * nothing to negotiate — the only decision is whether to commit to that time.
 *
 * The intro sits in the content rather than the title bar, and states
 * first-accept-wins up front: a technician who reads a card carefully can lose
 * it to someone faster, and that has to read as the rule rather than a fault.
 */
export function PoolScreen() {
  const router = useRouter();
  const { data, isPending, isError, refetch } = usePool();

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <StatusBar style="dark" />
      <TitleBar title="Open job pool" onBack={() => router.replace('/(app)/(tabs)')} />

      <ScrollView
        contentContainerStyle={{ paddingTop: 14, paddingHorizontal: 16, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <Text
          style={{
            fontFamily: 'Roboto_400Regular',
            fontSize: 12.5,
            lineHeight: 19,
            color: color.textSecondary,
            marginHorizontal: 2,
            marginBottom: 14,
          }}
        >
          Confirmed slots matching your category &amp; pincodes. First to accept wins — customer
          details stay masked until you accept.
        </Text>

        {isPending ? (
          <>
            <JobCardSkeleton />
            <JobCardSkeleton />
            <JobCardSkeleton />
          </>
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : data.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 50, paddingHorizontal: 20 }}>
            <Text
              style={{ fontFamily: 'Roboto_700Bold', fontSize: 14.5, color: color.textLabel }}
            >
              Pool is empty
            </Text>
            <Text
              style={{
                fontFamily: 'Roboto_400Regular',
                fontSize: 12.5,
                color: color.textMuted,
                marginTop: 4,
              }}
            >
              You&apos;ve taken every open job nearby.
            </Text>
          </View>
        ) : (
          data.map((job) => (
            <PoolJobCard key={job.id} job={job} onPress={() => router.push(`/pool/${job.id}`)} />
          ))
        )}
      </ScrollView>
    </View>
  );
}
