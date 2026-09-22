import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState, Skeleton } from '@/components/feedback';
import { Icon } from '@/components/icons/Icon';
import { ScreenStatusBar } from '@/components/layout';
import { Avatar, Button, Switch, Text } from '@/components/ui';
import { usePushToggle } from '@/features/notifications/hooks/usePushToggle';
import { useMe } from '@/features/profile/hooks/useMe';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { AVAILABLE_LANGUAGES } from '@/i18n';
import { errorText } from '@/i18n/errorText';
import { LANGUAGES } from '@/i18n/languages';
import { useLanguage } from '@/store/language.store';
import { shortCategory } from '@/lib/shortCategory';
import { useProfileStore } from '@/store/profile.store';
import { useSession } from '@/store/session.store';
import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';

/** Screen 16 — Profile & settings. */
export function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // Server state, seeded from the session so this paints on the first frame.
  const { data: me, isError, error, refetch } = useMe();
  // Spinner for the pull only. On `isFetching` it also ran whenever a push
  // invalidated `me` — a manager approving a UPI change spun it with nobody
  // touching the screen.
  const pull = usePullToRefresh(refetch);

  const signOut = useSession((s) => s.signOut);
  const avatarUri = useProfileStore((s) => s.avatarUri);
  const clearAvatar = useProfileStore((s) => s.clearAvatar);
  // Persisted per DEVICE and connected to the server, not local component
  // state: this was `useState(true)`, which reset on every launch and pushed
  // to a technician who had switched it off.
  const { enabled: pushEnabled, toggle: togglePush } = usePushToggle();
  const activeLanguage = useLanguage((s) => s.active);
  const languageName =
    LANGUAGES.find((l) => l.code === activeLanguage)?.nativeName ?? activeLanguage;

  // The coverage row abbreviates, matching the prototype — the full names wrap.
  const categories = me?.subcategories.map((c) => shortCategory(c.name)).join(' · ') ?? '—';

  // Only when there is nothing at all to show. With a session seed the screen
  // stays usable offline and a failed refetch is silent — a technician out of
  // signal should still be able to read their own pincodes.
  if (!me && isError) {
    return (
      <View style={{ flex: 1, backgroundColor: color.surface, justifyContent: 'center' }}>
        <ScreenStatusBar style="dark" />
        <ErrorState
          title={t('profile.loadFailed')}
          body={
            error instanceof Error
              ? errorText(error, t('components.errorState.body'))
              : undefined
          }
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
        refreshControl={<RefreshControl {...pull} />}
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
                accessibilityLabel={avatarUri ? t('profile.viewPhoto') : t('profile.addPhoto')}
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
                {t('profile.idLine', { code: me.code })}
              </Text>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16, alignSelf: 'stretch' }}>
                {/* A dash, not a zero: a technician who has closed nothing
                    yet has no rating, and 0.0 reads as the worst score there
                    is. */}
                <ChromeStat
                  value={me.rating === null ? '—' : me.rating.toFixed(1)}
                  label={t('profile.stats.rating')}
                />
                {/* Null until the first closure is counted — `String(null)`
                    used to print the word "null" here. */}
                <ChromeStat
                  value={me.jobsCompleted === null ? '—' : String(me.jobsCompleted)}
                  label={t('profile.stats.jobsDone')}
                />
                <ChromeStat
                  value={me.onTimePct === null ? '—' : `${me.onTimePct}%`}
                  label={t('profile.stats.onTime')}
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
              {t('profile.coverage.title')}
            </Text>

            <CoverageRow label={t('profile.coverage.categories')} value={categories} first />
            <CoverageRow
              label={t('profile.coverage.pincodes')}
              value={me?.pincodes.join(', ') ?? '—'}
            />
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
              accessibilityLabel={t('profile.rows.availabilityA11y')}
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
                    {t('availability.title')}
                  </Text>
                  <Icon name="chevronRight" size={19} color={color.textMuted} />
                </View>
              )}
            </Pressable>

            {/* Where their money goes. A link rather than a value: the screen
                behind it adds the first UPI ID (proved by a WhatsApp code) and
                asks a manager for any change after that. The VPA itself is
                shown beside the chevron so the common question ("is it the
                right account?") is answered without opening the screen. */}
            <Pressable
              onPress={() => router.push('/payout-account')}
              accessibilityRole="button"
              accessibilityLabel={t('payout.title')}
            >
              {({ pressed }) => (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 13,
                    paddingVertical: 15,
                    paddingHorizontal: 16,
                    borderTopWidth: 1,
                    borderTopColor: palette.neutral[100],
                    backgroundColor: pressed ? color.surfaceSunkenAlt : 'transparent',
                  }}
                >
                  <Icon name="wallet" size={21} color={color.textLabel} strokeWidth={1.7} />
                  <Text
                    style={{
                      fontFamily: 'Roboto_500Medium',
                      fontSize: 14.5,
                      color: color.textPrimary,
                    }}
                  >
                    {t('payout.title')}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={{
                      flex: 1,
                      textAlign: 'right',
                      fontFamily: 'Roboto_400Regular',
                      fontSize: 13,
                      color: color.textMuted,
                    }}
                  >
                    {me?.upiId ?? '—'}
                  </Text>
                  <Icon name="chevronRight" size={19} color={color.textMuted} />
                </View>
              )}
            </Pressable>

            <Pressable
              onPress={togglePush}
              accessibilityRole="switch"
              accessibilityState={{ checked: pushEnabled }}
              accessibilityLabel={t('profile.rows.push')}
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
                  {t('profile.rows.push')}
                </Text>
                {/* Row is the tap target, so the switch is presentational. */}
                <Switch value={pushEnabled} onValueChange={togglePush} static />
              </View>
            </Pressable>

            {/* The prototype's `Language · English` row, and now a way in: it
                opens the language list and shows the one in use, in its own
                script. A link like Payout account, chevron and all — and a
                plain value while the app speaks only one language, because
                a list of one is not a choice. */}
            <Pressable
              onPress={() => router.push('/language')}
              disabled={AVAILABLE_LANGUAGES.length < 2}
              accessibilityRole="button"
              accessibilityLabel={`${t('language.title')}: ${languageName}`}
            >
              {({ pressed }) => (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 13,
                    paddingVertical: 15,
                    paddingHorizontal: 16,
                    borderTopWidth: 1,
                    borderTopColor: palette.neutral[100],
                    backgroundColor: pressed ? color.surfaceSunkenAlt : 'transparent',
                  }}
                >
                  <Icon name="globe" size={21} color={color.textLabel} strokeWidth={1.7} />
                  <Text
                    style={{
                      fontFamily: 'Roboto_500Medium',
                      fontSize: 14.5,
                      color: color.textPrimary,
                    }}
                  >
                    {t('language.title')}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={{
                      flex: 1,
                      textAlign: 'right',
                      fontFamily: 'Roboto_400Regular',
                      fontSize: 13,
                      color: color.textMuted,
                    }}
                  >
                    {languageName}
                  </Text>
                  {AVAILABLE_LANGUAGES.length > 1 ? (
                    <Icon name="chevronRight" size={19} color={color.textMuted} />
                  ) : null}
                </View>
              )}
            </Pressable>

            {/* A Play Store requirement, not a prototype row — every account a
                technician creates themselves needs an in-app way to delete it. */}
            <Pressable
              onPress={() => router.push('/delete-account')}
              accessibilityRole="button"
              accessibilityLabel={t('profile.delete.title')}
            >
              {({ pressed }) => (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 13,
                    paddingVertical: 15,
                    paddingHorizontal: 16,
                    borderTopWidth: 1,
                    borderTopColor: palette.neutral[100],
                    backgroundColor: pressed ? color.surfaceSunkenAlt : 'transparent',
                  }}
                >
                  <Icon name="trash" size={21} color={color.textDanger} strokeWidth={1.7} />
                  <Text
                    style={{
                      flex: 1,
                      fontFamily: 'Roboto_500Medium',
                      fontSize: 14.5,
                      color: color.textDanger,
                    }}
                  >
                    {t('profile.delete.title')}
                  </Text>
                  <Icon name="chevronRight" size={19} color={color.textMuted} />
                </View>
              )}
            </Pressable>
          </View>

          <View style={{ marginTop: 16 }}>
            <Button
              label={t('profile.logOut')}
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
