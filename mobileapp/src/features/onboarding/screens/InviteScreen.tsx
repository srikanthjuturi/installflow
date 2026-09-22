import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState, Skeleton } from '@/components/feedback';
import { ScreenStatusBar } from '@/components/layout';
import { Icon } from '@/components/icons/Icon';
import { BrandMark, Button, Text } from '@/components/ui';
import { useLanguagePrompt } from '@/features/language/hooks/useLanguagePrompt';
import { resolveInvite } from '@/features/onboarding/api/invite';
import { errorText } from '@/i18n/errorText';
import { ApiError } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { useRegistration } from '@/store/registration.store';
import { color } from '@/theme/semantic';

export interface InviteScreenProps {
  /** From the deep link `reliancegreentech://invite/<token>`. */
  token: string;
}

/** "+919876543210" → "+91 98765 43210". */
function prettyPhone(e164: string): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}

/**
 * R1 — Register via invite link.
 *
 * A confirmation screen, not a form: it shows what the manager already decided
 * and the technician confirms it. That is unchanged from the approved design.
 *
 * What changed is how much is known. A manager can invite with nothing but a
 * phone number, so the panel renders the rows that HAVE a value rather than a
 * fixed five — the name and technician ID do not exist yet, and blank rows for
 * them would read as missing data rather than as data still to come. The
 * typing moved to its own screen (R1b) so this one keeps its approved pixels.
 *
 * Layout values are taken verbatim from the approved prototype: white page at
 * 30/26/26 padding, a 58px dark tile, the panel on #f6f8fa at radius 16, and
 * the CTA inline in the flow rather than pinned to the bottom.
 */
export function InviteScreen({ token }: InviteScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  // An invite link opens here without ever passing sign-in, so this is where
  // an invited technician's first launch offers the language list.
  useLanguagePrompt();
  const start = useRegistration((s) => s.start);

  const {
    data,
    isPending,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: qk.invite(token),
    queryFn: () => resolveInvite(token),
    // The link is single-use and short-lived; refetching it mid-flow would
    // only ever turn a working screen into an error.
    staleTime: Infinity,
    retry: false,
  });

  const fields = data
    ? [
        {
          id: 'mobile',
          label: t('onboarding.invite.fields.mobile'),
          value: prettyPhone(data.phone),
        },
        {
          id: 'onboardedBy',
          label: t('onboarding.invite.fields.onboardedBy'),
          value: data.invitedByName ?? data.companyName,
        },
        { id: 'region', label: t('onboarding.invite.fields.region'), value: data.regionName },
      ]
    : [];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.surfaceRaised }}
      contentContainerStyle={{
        paddingTop: insets.top + 30,
        paddingHorizontal: 26,
        paddingBottom: insets.bottom + 26,
      }}
      showsVerticalScrollIndicator={false}
    >
      <ScreenStatusBar style="dark" />

      <Animated.View
        entering={FadeInDown.duration(340)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
      >
        <Icon name="link" size={16} color={color.actionBg} />
        <Text style={{ fontFamily: 'Roboto_700Bold', fontSize: 12, color: color.actionBg }}>
          {t('onboarding.invite.eyebrow')}
        </Text>
      </Animated.View>

      {/*
       * The shared BrandMark, not a copy of it. This screen used to re-draw the
       * tile inline, which is how it kept the old "V" glyph after the mark had
       * already changed everywhere else.
       *
       * The mark is passed explicitly rather than left to `useBrand`: nobody is
       * signed in yet, so the session names no company — but the resolved
       * invite does, and it is the company doing the inviting that this screen
       * is about. Falls back to the platform mark until the lookup lands.
       */}
      <Animated.View entering={FadeInDown.delay(60).duration(340)} style={{ marginTop: 18 }}>
        <BrandMark mark={data?.companyCode} />
      </Animated.View>

      {isError ? (
        <ErrorState
          title={
            error instanceof ApiError && error.status === 0
              ? t('onboarding.invite.errors.offlineTitle')
              : t('onboarding.invite.errors.title')
          }
          /*
           * The SERVER's message, not a guess.
           *
           * This used to say "the link may have expired" for every failure,
           * including a network one — so an app that simply could not reach the
           * API told the technician their invite had expired, and the manager
           * reissued a perfectly good link. The API already distinguishes
           * cancelled, expired and already-registered, and each has a different
           * remedy.
           *
           * In other languages those arrive as statuses with no code — 404 not
           * valid, 409 used or cancelled, 410 expired — so they share one
           * translated sentence that covers every remedy. See `errorText`.
           */
          body={
            error instanceof ApiError && error.message
              ? errorText(error, t('onboarding.invite.errors.askForNewLink'), {
                  404: t('onboarding.invite.errors.unusable'),
                  409: t('onboarding.invite.errors.unusable'),
                  410: t('onboarding.invite.errors.unusable'),
                })
              : t('onboarding.invite.errors.askForNewLink')
          }
          onRetry={() => refetch()}
        />
      ) : (
        <>
          {/* The animation sits on a View so the words stay in `ui/Text`,
              which Indian scripts need — an Animated.Text would bypass it. */}
          <Animated.View entering={FadeInDown.delay(120).duration(340)} style={{ marginTop: 18 }}>
            <Text
              style={{
                fontFamily: 'Roboto_900Black',
                fontSize: 25,
                lineHeight: 29,
                letterSpacing: -0.5,
                color: color.textPrimary,
              }}
            >
              {t('onboarding.invite.title')}
            </Text>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(170).duration(340)} style={{ marginTop: 8 }}>
            <Text
              style={{
                fontFamily: 'Roboto_400Regular',
                fontSize: 13.5,
                lineHeight: 20,
                color: color.textSecondary,
              }}
            >
              {t('onboarding.invite.body')}
            </Text>
          </Animated.View>

          <Animated.View
            entering={FadeInDown.delay(220).duration(340)}
            style={{
              marginTop: 22,
              backgroundColor: color.surfaceSunkenAlt,
              borderWidth: 1,
              borderColor: color.border,
              borderRadius: 16,
              paddingHorizontal: 16,
              paddingVertical: 6,
            }}
          >
            {isPending
              ? [0, 1, 2].map((i) => (
                  <View
                    key={i}
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      paddingVertical: 13,
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: color.border,
                    }}
                  >
                    <Skeleton width={84} height={13} />
                    <Skeleton width={124} height={13} />
                  </View>
                ))
              : fields.map((field, i) => (
                  <View
                    key={field.id}
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      paddingVertical: 13,
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: color.border,
                      gap: 16,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: 'Roboto_400Regular',
                        fontSize: 13,
                        color: color.textSecondary,
                      }}
                    >
                      {field.label}
                    </Text>
                    <Text
                      style={{
                        fontFamily: 'Roboto_700Bold',
                        fontSize: 13.5,
                        color: color.textPrimary,
                        flexShrink: 1,
                        textAlign: 'right',
                      }}
                    >
                      {field.value}
                    </Text>
                  </View>
                ))}
          </Animated.View>

          <Animated.View
            entering={FadeInDown.delay(280).duration(340)}
            style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}
          >
            <View style={{ paddingTop: 1 }}>
              <Icon name="lock" size={15} color={color.textMuted} />
            </View>
            <Text
              style={{
                flex: 1,
                fontFamily: 'Roboto_400Regular',
                fontSize: 12,
                lineHeight: 17,
                color: color.textFootnote,
              }}
            >
              {t('onboarding.invite.locked')}
            </Text>
          </Animated.View>

          <Animated.View
            entering={FadeInDown.delay(330).duration(340)}
            style={{ marginTop: 26 }}
          >
            <Button
              label={t('onboarding.invite.confirm')}
              trailingIcon="arrowRight"
              onPress={() => {
                if (!data) return;
                start(token, data);
                router.push('/register/profile');
              }}
              disabled={!data}
            />
          </Animated.View>
        </>
      )}
    </ScrollView>
  );
}
