import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, JobCardSkeleton } from '@/components/feedback';
import { Icon } from '@/components/icons/Icon';
import { Screen } from '@/components/layout';
import { Switch } from '@/components/ui';
import { JobCard } from '@/features/jobs/components/JobCard';
import { usePool, useTodayJobs } from '@/features/jobs/hooks/useJobs';
import { technician } from '@/mocks/db';
import { useAvailabilityStore } from '@/store/availability.store';
import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';

/**
 * Screen 2 — Home.
 *
 * Two jobs to do: tell the technician whether they're receiving offers, and
 * show what they've already committed to today. The pool banner is the only
 * route into unclaimed work from here.
 */
export function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const online = useAvailabilityStore((s) => s.online);
  const setOnline = useAvailabilityStore((s) => s.setOnline);

  const { data: pool } = usePool();
  const { data: today, isPending, isError, refetch } = useTodayJobs();

  const poolCount = pool?.length ?? 0;
  const todayCount = today?.length ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      {/* Dark chrome bleeding into the status bar, per the prototype. */}
      <View
        style={{
          backgroundColor: color.chrome,
          paddingTop: insets.top + 16,
          paddingHorizontal: 20,
          paddingBottom: 20,
        }}
      >
        <Text style={{ fontFamily: 'Roboto_400Regular', fontSize: 13, color: color.textMuted }}>
          Good morning
        </Text>
        <Text
          style={{
            fontFamily: 'Roboto_900Black',
            fontSize: 22,
            color: color.textInverse,
            marginTop: 2,
          }}
        >
          {technician.name}
        </Text>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: color.chromePanel,
            borderRadius: radius.lg,
            padding: 14,
            marginTop: 18,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text
              style={{ fontFamily: 'Roboto_700Bold', fontSize: 15, color: color.textInverse }}
            >
              {online ? "You're online" : "You're offline"}
            </Text>
            <Text
              style={{
                fontFamily: 'Roboto_400Regular',
                fontSize: 12.5,
                color: color.textMuted,
                marginTop: 2,
              }}
            >
              {online ? 'Receiving job offers' : 'Not receiving offers'}
            </Text>
          </View>

          <Switch
            value={online}
            onValueChange={setOnline}
            activeColor={color.online}
            accessibilityLabel="Receive job offers"
          />
        </View>
      </View>

      <Screen>
        {poolCount > 0 ? (
          <Pressable
            onPress={() => router.push('/pool')}
            accessibilityRole="button"
            accessibilityLabel={`${poolCount} new jobs in your area`}
          >
            {({ pressed }) => (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  backgroundColor: color.slotBg,
                  borderRadius: radius.lg,
                  padding: 14,
                  marginTop: 16,
                  opacity: pressed ? 0.8 : 1,
                }}
              >
                <Icon name="bell" size={20} color={color.slotFg} />
                <View style={{ flex: 1 }}>
                  <Text
                    style={{ fontFamily: 'Roboto_700Bold', fontSize: 14, color: color.slotFg }}
                  >
                    {poolCount} new {poolCount === 1 ? 'job' : 'jobs'} in your area
                  </Text>
                  <Text
                    style={{
                      fontFamily: 'Roboto_400Regular',
                      fontSize: 12,
                      color: color.slotFg,
                      marginTop: 1,
                    }}
                  >
                    Confirmed slots · tap to view the pool
                  </Text>
                </View>
              </View>
            )}
          </Pressable>
        ) : null}

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 24,
            marginBottom: 12,
          }}
        >
          <Text
            style={{ fontFamily: 'Roboto_900Black', fontSize: 17, color: color.textPrimary }}
          >
            Today&apos;s jobs
          </Text>
          {!isPending && !isError ? (
            <Text
              style={{ fontFamily: 'Roboto_500Medium', fontSize: 13, color: color.textSecondary }}
            >
              {todayCount} {todayCount === 1 ? 'job' : 'jobs'}
            </Text>
          ) : null}
        </View>

        {isPending ? (
          <>
            <JobCardSkeleton />
            <JobCardSkeleton />
          </>
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : todayCount === 0 ? (
          <EmptyState
            title="Nothing scheduled today"
            body="Accept a job from the pool to fill your day."
          />
        ) : (
          today.map((job) => (
            <JobCard key={job.id} job={job} onPress={() => router.push(`/job/${job.id}`)} />
          ))
        )}
      </Screen>
    </View>
  );
}
