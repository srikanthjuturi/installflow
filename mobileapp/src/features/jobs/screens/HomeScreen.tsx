import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState, JobCardSkeleton } from '@/components/feedback';
import { Icon } from '@/components/icons/Icon';
import { Avatar } from '@/components/ui';
import { TodayJobCard } from '@/features/jobs/components/TodayJobCard';
import { useGreeting } from '@/features/jobs/hooks/useGreeting';
import { usePool, useTodayJobs } from '@/features/jobs/hooks/useJobs';
import { useMe } from '@/features/profile/hooks/useMe';
import { useAvailabilityStore } from '@/store/availability.store';
import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';

/**
 * Screen 2 — Home.
 *
 * Two questions: am I receiving offers, and what have I committed to today.
 *
 * Layout from the prototype: dark header with 22px bottom corners bleeding
 * under the status bar, then a 16px content gutter (narrower than the 20-26
 * used on the form screens, because these are cards rather than prose).
 */
export function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // The signed-in technician. Shares the `me` query with the Profile tab, so
  // this is one request, not two — and it replaces a `technician` record
  // imported straight from the mock database, which greeted every user by the
  // same seeded name after they had just proved who they were with an OTP.
  const { data: me } = useMe();
  const greeting = useGreeting();

  const online = useAvailabilityStore((s) => s.online);
  const setOnline = useAvailabilityStore((s) => s.setOnline);

  const { data: pool } = usePool();
  const { data: today, isPending, isError, refetch } = useTodayJobs();

  const poolCount = pool?.length ?? 0;
  const todayCount = today?.length ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <StatusBar style="light" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
        <View
          style={{
            backgroundColor: color.chrome,
            paddingTop: insets.top + 14,
            paddingHorizontal: 20,
            paddingBottom: 22,
            borderBottomLeftRadius: 22,
            borderBottomRightRadius: 22,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            {/* Avatar beside the greeting — the app's identity anchor, and a
                shortcut into Profile where it can be changed. */}
            <Pressable
              onPress={() => router.push('/(app)/(tabs)/profile')}
              accessibilityRole="button"
              accessibilityLabel="Your profile"
              style={{ flex: 1 }}
            >
              {({ pressed }) => (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    opacity: pressed ? 0.75 : 1,
                  }}
                >
                  <Avatar name={me?.name ?? ''} size={44} radius={13} />

                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontFamily: 'Roboto_400Regular',
                        fontSize: 13,
                        color: color.textOnChrome,
                      }}
                    >
                      {greeting}
                    </Text>
                    <Text
                      style={{
                        fontFamily: 'Roboto_900Black',
                        fontSize: 20,
                        color: color.textInverse,
                      }}
                      numberOfLines={1}
                    >
                      {me?.name ?? ''}
                    </Text>
                  </View>
                </View>
              )}
            </Pressable>

            <Pressable
              onPress={() => router.push('/pool')}
              accessibilityRole="button"
              accessibilityLabel={`${poolCount} new jobs in your area`}
            >
              {({ pressed }) => (
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 13,
                    backgroundColor: color.chromeControl,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.7 : 1,
                  }}
                >
                  <Icon name="bell" size={22} color={color.textInverse} strokeWidth={1.7} />

                  {poolCount > 0 ? (
                    <View
                      style={{
                        position: 'absolute',
                        top: 9,
                        right: 10,
                        width: 9,
                        height: 9,
                        borderRadius: 4.5,
                        backgroundColor: color.notificationDot,
                        borderWidth: 2,
                        borderColor: color.chrome,
                      }}
                    />
                  ) : null}
                </View>
              )}
            </Pressable>
          </View>

          <Pressable
            onPress={() => setOnline(!online)}
            accessibilityRole="switch"
            accessibilityState={{ checked: online }}
            accessibilityLabel="Receive job offers"
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                backgroundColor: color.chromePanel,
                borderRadius: 14,
                paddingVertical: 12,
                paddingHorizontal: 14,
                marginTop: 16,
              }}
            >
              <View
                style={{
                  width: 44,
                  height: 26,
                  borderRadius: 999,
                  backgroundColor: online ? color.online : color.chromeTrackOff,
                  justifyContent: 'center',
                }}
              >
                <View
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    backgroundColor: color.textInverse,
                    marginLeft: online ? 21 : 3,
                  }}
                />
              </View>

              <View style={{ flex: 1 }}>
                <Text
                  style={{ fontFamily: 'Roboto_700Bold', fontSize: 14, color: color.textInverse }}
                >
                  {online ? "You're online" : "You're offline"}
                </Text>
                <Text
                  style={{
                    fontFamily: 'Roboto_400Regular',
                    fontSize: 12,
                    color: color.textOnChrome,
                  }}
                >
                  {online ? 'Receiving job offers' : 'Not receiving offers'}
                </Text>
              </View>
            </View>
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
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
                    backgroundColor: color.surfaceRaised,
                    borderWidth: 1,
                    borderColor: pressed ? color.actionBg : color.bannerBorder,
                    borderRadius: 16,
                    padding: 14,
                    marginBottom: 16,
                  }}
                >
                  <View
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 12,
                      backgroundColor: palette.primary[75],
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name="geo" size={22} color={color.actionBg} strokeWidth={1.7} />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontFamily: 'Roboto_700Bold',
                        fontSize: 14.5,
                        color: color.textPrimary,
                      }}
                    >
                      {poolCount} new {poolCount === 1 ? 'job' : 'jobs'} in your area
                    </Text>
                    <Text
                      style={{
                        fontFamily: 'Roboto_400Regular',
                        fontSize: 12.5,
                        color: color.textSecondary,
                      }}
                    >
                      Confirmed slots · tap to view the pool
                    </Text>
                  </View>

                  <Icon name="chevronRight" size={20} color={color.textMuted} />
                </View>
              )}
            </Pressable>
          ) : null}

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginHorizontal: 4,
              marginTop: 4,
              marginBottom: 12,
            }}
          >
            <Text
              style={{ fontFamily: 'Roboto_900Black', fontSize: 15, color: color.textPrimary }}
            >
              Today&apos;s jobs
            </Text>
            {!isPending && !isError ? (
              <Text
                style={{
                  fontFamily: 'Roboto_700Bold',
                  fontSize: 12,
                  color: color.textSecondary,
                }}
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
            <View
              style={{
                alignItems: 'center',
                paddingVertical: 40,
                paddingHorizontal: 20,
                backgroundColor: color.surfaceRaised,
                borderWidth: 1,
                borderStyle: 'dashed',
                borderColor: color.borderStrong,
                borderRadius: 18,
              }}
            >
              <Text
                style={{ fontFamily: 'Roboto_700Bold', fontSize: 14.5, color: color.textLabel }}
              >
                Nothing scheduled today
              </Text>
              <Text
                style={{
                  fontFamily: 'Roboto_400Regular',
                  fontSize: 12.5,
                  color: color.textMuted,
                  marginTop: 4,
                }}
              >
                Accept a job from the pool to fill your day.
              </Text>
            </View>
          ) : (
            today.map((job) => (
              <TodayJobCard
                key={job.id}
                job={job}
                onPress={() => router.push(`/job/${job.id}`)}
              />
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}
