import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState, Skeleton } from '@/components/feedback';
import { Icon, type IconName } from '@/components/icons/Icon';
import { ScreenStatusBar } from '@/components/layout';
import { Avatar, Button, Switch } from '@/components/ui';
import { useMe } from '@/features/profile/hooks/useMe';
import { useProfileStore } from '@/store/profile.store';
import { useSession } from '@/store/session.store';
import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';

/**
 * Push notifications is a switch rather than an "On" label: it's the one
 * setting here a technician actually flips, and it decides whether they hear
 * about new jobs at all. Language and payout account open their own flows, so
 * they stay as values.
 */
const SETTINGS: { label: string; value: string; icon: IconName }[] = [
  // English is a fact about this build — there is no i18n and no language
  // setting to read. The payout account is NOT: those digits were invented,
  // and a technician reading them would believe their money is going to an
  // account ending 4432. There is no payout account anywhere in the schema
  // yet, so this renders the same dash every unknown value does.
  { label: 'Language', value: 'English', icon: 'globe' },
  { label: 'Payout account', value: '—', icon: 'wallet' },
];

/**
 * The coverage row abbreviates, matching the prototype — the full names wrap.
 *
 * Keyed by name rather than by id: the catalogue is per-company and editable,
 * so an id here would be a value from one tenant's database baked into the app.
 * A name with no entry falls through unabbreviated.
 */
const SHORT_CATEGORY: Record<string, string> = {
  Television: 'TV',
  'Air Conditioner': 'AC',
  'Water Purifier': 'Purifier',
};

/** Screen 16 — Profile & settings. */
export function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  // Server state, seeded from the session so this paints on the first frame.
  const { data: me, isError, error, isFetching, refetch } = useMe();

  const signOut = useSession((s) => s.signOut);
  const avatarUri = useProfileStore((s) => s.avatarUri);
  const clearAvatar = useProfileStore((s) => s.clearAvatar);
  const [pushEnabled, setPushEnabled] = useState(true);

  const categories =
    me?.subcategories.map((c) => SHORT_CATEGORY[c.name] ?? c.name).join(' · ') ?? '—';

  // Only when there is nothing at all to show. With a session seed the screen
  // stays usable offline and a failed refetch is silent — a technician out of
  // signal should still be able to read their own pincodes.
  if (!me && isError) {
    return (
      <View style={{ flex: 1, backgroundColor: color.surface, justifyContent: 'center' }}>
        <ScreenStatusBar style="dark" />
        <ErrorState
          title="Couldn't load your profile"
          body={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScreenStatusBar style="light" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={isFetching}
            onRefresh={refetch}
            tintColor={color.textMuted}
          />
        }
      >
        <View
          style={{
            backgroundColor: color.chrome,
            alignItems: 'center',
            paddingTop: insets.top + 22,
            paddingHorizontal: 20,
            paddingBottom: 24,
            borderBottomLeftRadius: 22,
            borderBottomRightRadius: 22,
          }}
        >
          {!me ? (
            <View style={{ alignItems: 'center', gap: 10 }}>
              <Skeleton width={74} height={74} rounded={22} />
              <Skeleton width={150} height={20} />
            </View>
          ) : (
            <>
              {/* The photo opens the VIEWER; the camera badge opens the
                  change-photo sheet. With no photo there is nothing to look
                  at, so the tap goes straight to the sheet. */}
              <Pressable
                onPress={() => router.push(avatarUri ? '/view-photo' : '/avatar-options')}
                accessibilityRole="button"
                accessibilityLabel={avatarUri ? 'View profile picture' : 'Add profile picture'}
              >
                {({ pressed }) => (
                  <View style={{ opacity: pressed ? 0.8 : 1 }}>
                    <Avatar
                      name={me.name}
                      size={74}
                      radius={22}
                      editable
                      onBadgePress={() => router.push('/avatar-options')}
                    />
                  </View>
                )}
              </Pressable>

              <Text
                style={{
                  fontFamily: 'Roboto_900Black',
                  fontSize: 19,
                  color: color.textInverse,
                  marginTop: 12,
                }}
              >
                {me.name}
              </Text>
              <Text
                style={{
                  fontFamily: 'Roboto_400Regular',
                  fontSize: 12.5,
                  color: color.textOnChrome,
                  marginTop: 2,
                }}
              >
                Technician · ID {me.code}
              </Text>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16, alignSelf: 'stretch' }}>
                {/* A dash, not a zero: a technician who has closed nothing
                    yet has no rating, and 0.0 reads as the worst score there
                    is. */}
                <ChromeStat
                  value={me.rating === null ? '—' : me.rating.toFixed(1)}
                  label="Rating"
                />
                <ChromeStat value={String(me.jobsCompleted)} label="Jobs done" />
                <ChromeStat
                  value={me.onTimePct === null ? '—' : `${me.onTimePct}%`}
                  label="On-time"
                />
              </View>
            </>
          )}
        </View>

        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <View
            style={{
              backgroundColor: color.surfaceRaised,
              borderWidth: 1,
              borderColor: color.border,
              borderRadius: 16,
              padding: 16,
              marginBottom: 16,
            }}
          >
            <Text
              style={{
                fontFamily: 'Roboto_700Bold',
                fontSize: 11,
                letterSpacing: 0.88,
                textTransform: 'uppercase',
                color: color.textFootnote,
                marginBottom: 12,
              }}
            >
              Service coverage
            </Text>

            <CoverageRow label="Categories" value={categories} first />
            <CoverageRow label="Pincodes" value={me?.pincodes.join(', ') ?? '—'} />
          </View>

          <View
            style={{
              backgroundColor: color.surfaceRaised,
              borderWidth: 1,
              borderColor: color.border,
              borderRadius: 16,
              overflow: 'hidden',
            }}
          >
            <Pressable
              onPress={() => router.push('/availability')}
              accessibilityRole="button"
              accessibilityLabel="Availability and bandwidth"
            >
              {({ pressed }) => (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 13,
                    paddingVertical: 15,
                    paddingHorizontal: 16,
                    backgroundColor: pressed ? color.surfaceSunkenAlt : 'transparent',
                  }}
                >
                  <Icon name="calendar" size={21} color={color.textLabel} strokeWidth={1.7} />
                  <Text
                    style={{
                      flex: 1,
                      fontFamily: 'Roboto_500Medium',
                      fontSize: 14.5,
                      color: color.textPrimary,
                    }}
                  >
                    Availability &amp; bandwidth
                  </Text>
                  <Icon name="chevronRight" size={19} color={color.textMuted} />
                </View>
              )}
            </Pressable>

            <Pressable
              onPress={() => setPushEnabled(!pushEnabled)}
              accessibilityRole="switch"
              accessibilityState={{ checked: pushEnabled }}
              accessibilityLabel="Push notifications"
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 13,
                  paddingVertical: 15,
                  paddingHorizontal: 16,
                  borderTopWidth: 1,
                  borderTopColor: palette.neutral[100],
                }}
              >
                <Icon name="bell" size={21} color={color.textLabel} strokeWidth={1.7} />
                <Text
                  style={{
                    flex: 1,
                    fontFamily: 'Roboto_500Medium',
                    fontSize: 14.5,
                    color: color.textPrimary,
                  }}
                >
                  Push notifications
                </Text>
                {/* Row is the tap target, so the switch is presentational. */}
                <Switch value={pushEnabled} onValueChange={setPushEnabled} static />
              </View>
            </Pressable>

            {SETTINGS.map((row) => (
              <View
                key={row.label}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 13,
                  paddingVertical: 15,
                  paddingHorizontal: 16,
                  borderTopWidth: 1,
                  borderTopColor: palette.neutral[100],
                }}
              >
                <Icon name={row.icon} size={21} color={color.textLabel} strokeWidth={1.7} />
                <Text
                  style={{
                    flex: 1,
                    fontFamily: 'Roboto_500Medium',
                    fontSize: 14.5,
                    color: color.textPrimary,
                  }}
                >
                  {row.label}
                </Text>
                <Text
                  style={{
                    fontFamily: 'Roboto_400Regular',
                    fontSize: 13,
                    color: color.textMuted,
                  }}
                >
                  {row.value}
                </Text>
              </View>
            ))}
          </View>

          <View style={{ marginTop: 16 }}>
            <Button
              label="Log out"
              variant="dangerOutline"
              onPress={() => {
                // Clear the session first: the `(app)` guard redirects on its
                // own, and navigating before the token is gone would race it.
                signOut();
                // Then everything derived from it. Without this the next
                // technician to sign in on this handset opens on the previous
                // one's name, coverage and photo until the first refetch
                // lands — one company's data showing inside another's session.
                queryClient.clear();
                clearAvatar();
                router.replace('/(auth)/login');
              }}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function ChromeStat({ value, label }: { value: string; label: string }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: color.chromePanel,
        borderRadius: 12,
        padding: 10,
        alignItems: 'center',
      }}
    >
      <Text style={{ fontFamily: 'Roboto_900Black', fontSize: 17, color: color.textInverse }}>
        {value}
      </Text>
      <Text style={{ fontFamily: 'Roboto_400Regular', fontSize: 11, color: color.textOnChrome }}>
        {label}
      </Text>
    </View>
  );
}

function CoverageRow({ label, value, first }: { label: string; value: string; first?: boolean }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 16,
        paddingVertical: 7,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: palette.neutral[100],
      }}
    >
      <Text style={{ fontFamily: 'Roboto_400Regular', fontSize: 13, color: color.textSecondary }}>
        {label}
      </Text>
      <Text
        style={{
          fontFamily: 'Roboto_700Bold',
          fontSize: 13,
          color: color.textPrimary,
          flexShrink: 1,
          textAlign: 'right',
        }}
      >
        {value}
      </Text>
    </View>
  );
}
