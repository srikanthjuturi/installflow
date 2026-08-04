import { useRouter } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState, Skeleton } from '@/components/feedback';
import { Icon } from '@/components/icons/Icon';
import { Button } from '@/components/ui';
import { useInvite } from '@/features/onboarding/hooks/useInvite';
import { color } from '@/theme/semantic';

export interface InviteScreenProps {
  /** From the deep link `videocontech://invite/<token>`. */
  token: string;
}

/**
 * R1 — Register via invite link.
 *
 * Identity is set by the ASM who onboarded this technician, so every field is
 * read-only. The technician confirms rather than fills in; the only route to a
 * correction is through their ASM.
 *
 * Layout values are taken verbatim from the approved prototype: white page at
 * 30/26/26 padding, a 58px dark tile, the panel on #f6f8fa at radius 16, and
 * the CTA inline in the flow rather than pinned to the bottom.
 */
export function InviteScreen({ token }: InviteScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, isPending, isError, refetch } = useInvite(token);

  const firstName = data?.fullName.split(' ')[0] ?? '';

  const fields = data
    ? [
        { label: 'Full name', value: data.fullName },
        { label: 'Mobile', value: data.mobile },
        { label: 'Technician ID', value: data.technicianId },
        { label: 'Onboarded by', value: data.onboardedBy },
        { label: 'Region', value: data.region },
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
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="link" size={16} color={color.actionBg} />
        <Text style={{ fontFamily: 'Roboto_700Bold', fontSize: 12, color: color.actionBg }}>
          SECURE INVITE LINK
        </Text>
      </View>

      <View
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
      </View>

      {isError ? (
        <ErrorState
          title="This invite couldn't be opened"
          body="The link may have expired. Ask your ASM to send a new one."
          onRetry={() => refetch()}
        />
      ) : (
        <>
          <Text
            style={{
              fontFamily: 'Roboto_900Black',
              fontSize: 25,
              lineHeight: 29,
              letterSpacing: -0.5,
              color: color.textPrimary,
              marginTop: 18,
            }}
          >
            {isPending ? 'Welcome —' : `Welcome, ${firstName} —`}
            {'\n'}set up your account
          </Text>

          <Text
            style={{
              fontFamily: 'Roboto_400Regular',
              fontSize: 13.5,
              lineHeight: 20,
              color: color.textSecondary,
              marginTop: 8,
            }}
          >
            Your onboarding partner pre-filled these details in this link. Confirm they&apos;re
            correct.
          </Text>

          <View
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
              ? [0, 1, 2, 3, 4].map((i) => (
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
          </View>

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
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
              Details are locked. Contact your ASM to change name or phone.
            </Text>
          </View>

          <View style={{ marginTop: 26 }}>
            <Button
              label="Confirm & continue"
              trailingIcon="arrowRight"
              onPress={() => router.push('/coverage')}
              disabled={!data}
            />
          </View>
        </>
      )}
    </ScrollView>
  );
}
