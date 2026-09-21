import { useRouter } from 'expo-router';
import { RefreshControl, ScrollView, Text, View } from 'react-native';

import { ErrorState, JobCardSkeleton } from '@/components/feedback';
import { ScreenStatusBar, TitleBar } from '@/components/layout';
import { useAcceptingWork } from '@/features/availability/hooks/useAvailability';
import { PoolJobCard } from '@/features/jobs/components/PoolJobCard';
import { usePool } from '@/features/jobs/hooks/useJobs';
import { useButtonNavInset } from '@/hooks/useButtonNavInset';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { color } from '@/theme/semantic';

/**
 * Screen 4 — Open job pool.
 *
 * Two kinds of job now, and the card says which. One carries a
 * customer-confirmed slot and the only decision is whether to commit to that
 * time. The other has no time yet: it is offered from the moment the vendor
 * raises it, in parallel with the customer being asked to pick a window, and
 * accepting it commits to the JOB rather than to an hour.
 *
 * Both are real work and both pay the same, which is why they share a list.
 *
 * The intro sits in the content rather than the title bar, and states
 * first-accept-wins up front: a technician who reads a card carefully can lose
 * it to someone faster, and that has to read as the rule rather than a fault.
 */
export function PoolScreen() {
  const router = useRouter();
  const online = useAcceptingWork();
  const { data, isPending, isError, refetch } = usePool();
  // Room for the ◁ ○ □ bar, so the last card clears it — see the hook.
  const navInset = useButtonNavInset();
  // The list polls itself, but a technician who has just been told about a job
  // on the phone will pull anyway — and being unable to is what makes an app
  // feel stuck. The spinner follows the pull only: tied to `isRefetching` it
  // also lit up on every poll, with nobody touching the screen.
  const pull = usePullToRefresh(refetch);

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScreenStatusBar style="dark" />
      <TitleBar title="Open job pool" onBack={() => router.replace('/(app)/(tabs)')} />

      <ScrollView
        contentContainerStyle={{
          paddingTop: 14,
          paddingHorizontal: 16,
          paddingBottom: 24 + navInset,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl {...pull} />}
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
          {/* ⚠ CHANGED FROM APPROVED COPY, and it had to be. The approved line
              opened "Confirmed slots matching your category & pincodes", which
              is no longer true: a job is offered from the moment it is raised,
              before the customer has picked a time. Leaving it would be the
              screen telling a technician every card has a slot while some of
              them plainly say otherwise.

              Pending sign-off. The two clauses that ARE approved — first to
              accept wins, details masked until you accept — are kept verbatim,
              because neither changed. */}
          Jobs matching your category &amp; pincodes. First to accept wins — customer details
          stay masked until you accept.
        </Text>

        {!online ? (
          /* `usePool` is `enabled: online`, and a DISABLED query in Query v5
             never leaves `pending` — so without this branch an offline
             technician sat in front of three loading skeletons forever, with
             nothing saying why or how to fix it. */
          <View style={{ alignItems: 'center', paddingVertical: 50, paddingHorizontal: 20 }}>
            <Text
              style={{ fontFamily: 'Roboto_700Bold', fontSize: 14.5, color: color.textLabel }}
            >
              You&apos;re offline
            </Text>
            <Text
              style={{
                fontFamily: 'Roboto_400Regular',
                fontSize: 12.5,
                color: color.textMuted,
                marginTop: 4,
                textAlign: 'center',
              }}
            >
              Turn availability on from Home to start receiving offers.
            </Text>
          </View>
        ) : isPending ? (
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
