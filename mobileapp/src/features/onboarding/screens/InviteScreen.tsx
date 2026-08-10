import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ScrollView, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState, Skeleton } from '@/components/feedback';
import { Icon } from '@/components/icons/Icon';
import { Button } from '@/components/ui';
import { resolveInvite } from '@/features/onboarding/api/invite';
import { qk } from '@/lib/queryKeys';
import { useRegistration } from '@/store/registration.store';
import { color } from '@/theme/semantic';

export interface InviteScreenProps {
  /** From the deep link `videocontech://invite/<token>`. */
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
  const start = useRegistration((s) => s.start);

  const {
    data,
    isPending,
    isError,
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
        { label: 'Mobile', value: prettyPhone(data.phone) },
        { label: 'Onboarded by', value: data.invitedByName ?? data.companyName },
        { label: 'Region', value: data.regionName },
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
      <StatusBar style="dark" />

      <Animated.View
        entering={FadeInDown.duration(340)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
      >
        <Icon name="link" size={16} color={color.actionBg} />
        <Text style={{ fontFamily: 'Roboto_700Bold', fontSize: 12, color: color.actionBg }}>
          SECURE INVITE LINK
        </Text>
      </Animated.View>

      <Animated.View
        entering={FadeInDown.delay(60).duration(340)}
        style={{
          width: 58,
          height: 58,
          borderRadius: 17,
          backgroundColor: color.chrome,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 18,
        }}
      >
        <Text style={{ fontFamily: 'Roboto_900Black', fontSize: 22, color: color.textInverse }}>
          V
        </Text>
      </Animated.View>

      {isError ? (
        <ErrorState
          title="This invite couldn't be opened"
          body="The link may have expired. Ask your ASM to send a new one."
          onRetry={() => refetch()}
        />
      ) : (
        <>
          <Animated.Text
            entering={FadeInDown.delay(120).duration(340)}
            style={{
              fontFamily: 'Roboto_900Black',
              fontSize: 25,
              lineHeight: 29,
              letterSpacing: -0.5,
              color: color.textPrimary,
              marginTop: 18,
            }}
          >
            Welcome —{'\n'}set up your account
          </Animated.Text>

          <Animated.Text
            entering={FadeInDown.delay(170).duration(340)}
            style={{
              fontFamily: 'Roboto_400Regular',
              fontSize: 13.5,
              lineHeight: 20,
              color: color.textSecondary,
              marginTop: 8,
            }}
          >
            Your onboarding partner set these up for you. Confirm they&apos;re correct — you
            add the rest next.
          </Animated.Text>

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
                    key={field.label}
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
              Your mobile number is locked to this invite. Contact your ASM to change it.
            </Text>
          </Animated.View>

          <Animated.View
            entering={FadeInDown.delay(330).duration(340)}
            style={{ marginTop: 26 }}
          >
            <Button
              label="Confirm & continue"
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
