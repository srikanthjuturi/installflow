import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { ErrorState, Skeleton } from '@/components/feedback';
import { Screen } from '@/components/layout';
import { BrandMark, Button, Card, DetailRow } from '@/components/ui';
import { useInvite } from '@/features/onboarding/hooks/useInvite';
import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';

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
 */
export function InviteScreen({ token }: InviteScreenProps) {
  const router = useRouter();
  const { data, isPending, isError, refetch } = useInvite(token);

  const firstName = data?.fullName.split(' ')[0] ?? '';

  return (
    <Screen
      footer={
        <Button
          label="Confirm & continue"
          onPress={() => router.push('/coverage')}
          disabled={!data}
        />
      }
    >
      <View style={{ paddingTop: 56 }}>
        <View
          style={{
            alignSelf: 'flex-start',
            backgroundColor: color.statusCompleted.bg,
            borderRadius: radius.full,
            paddingHorizontal: 10,
            paddingVertical: 5,
            marginBottom: 20,
          }}
        >
          <Text
            style={{
              fontFamily: 'Roboto_700Bold',
              fontSize: 10,
              letterSpacing: 1.2,
              color: color.statusCompleted.fg,
            }}
          >
            SECURE INVITE LINK
          </Text>
        </View>

        <BrandMark size={56} />

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
                lineHeight: 31,
                color: color.textPrimary,
                marginTop: 20,
                letterSpacing: -0.5,
              }}
            >
              {isPending ? 'Welcome —' : `Welcome, ${firstName} —`}
              {'\n'}set up your account
            </Text>

            <Text
              style={{
                fontFamily: 'Roboto_400Regular',
                fontSize: 14,
                lineHeight: 21,
                color: color.textSecondary,
                marginTop: 10,
                marginBottom: 24,
              }}
            >
              Your onboarding partner pre-filled these details in this link. Confirm they&apos;re
              correct.
            </Text>

            <Card>
              {isPending ? (
                <View style={{ gap: 18, paddingVertical: 4 }}>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <View
                      key={i}
                      style={{ flexDirection: 'row', justifyContent: 'space-between' }}
                    >
                      <Skeleton width={90} height={13} />
                      <Skeleton width={130} height={13} />
                    </View>
                  ))}
                </View>
              ) : (
                <>
                  <DetailRow label="Full name" value={data.fullName} first />
                  <DetailRow label="Mobile" value={data.mobile} />
                  <DetailRow label="Technician ID" value={data.technicianId} />
                  <DetailRow label="Onboarded by" value={data.onboardedBy} />
                  <DetailRow label="Region" value={data.region} />
                </>
              )}
            </Card>

            <Text
              style={{
                fontFamily: 'Roboto_400Regular',
                fontSize: 12,
                lineHeight: 18,
                color: color.textMuted,
                marginTop: 14,
              }}
            >
              Details are locked. Contact your ASM to change name or phone.
            </Text>
          </>
        )}
      </View>
    </Screen>
  );
}
