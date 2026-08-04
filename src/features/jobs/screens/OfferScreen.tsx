import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { ErrorState, Skeleton } from '@/components/feedback';
import { Icon } from '@/components/icons/Icon';
import { Header, Screen } from '@/components/layout';
import { Button, Card, DetailRow } from '@/components/ui';
import { useOffer } from '@/features/jobs/hooks/useJobs';
import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';
import { formatPaise } from '@/utils/money';

export interface OfferScreenProps {
  jobId: string;
}

/**
 * Screen 5 — Job offer, masked.
 *
 * Shows exactly enough to decide — slot, payout, area, distance — and nothing
 * that identifies the customer. That boundary is doc §6 and it is deliberate:
 * releasing names and phone numbers to every eligible technician for every
 * open job would leak customer data across the whole workforce.
 */
export function OfferScreen({ jobId }: OfferScreenProps) {
  const router = useRouter();
  const { data: job, isPending, isError, refetch } = useOffer(jobId);

  return (
    <>
      <Header eyebrow={job?.id ?? 'Job offer'} title="Job offer" tone="chrome" />

      <Screen
        footer={
          <View style={{ gap: 10 }}>
            <Button
              label="Accept job"
              onPress={() => router.push(`/accept-slot?jobId=${jobId}`)}
              disabled={!job}
            />
            <Button label="Pass" variant="ghost" onPress={() => router.back()} />
          </View>
        }
      >
        {isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : isPending ? (
          <View style={{ gap: 14, paddingTop: 20 }}>
            <Skeleton width="60%" height={22} />
            <Skeleton width="100%" height={80} rounded={radius.lg} />
            <Skeleton width="100%" height={200} rounded={radius.lg} />
          </View>
        ) : (
          <>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                marginTop: 20,
                marginBottom: 10,
              }}
            >
              <Text
                style={{ fontFamily: 'Roboto_700Bold', fontSize: 13, color: color.textSecondary }}
              >
                {job.category}
              </Text>
              <View
                style={{
                  backgroundColor: color.surfaceSunken,
                  borderRadius: radius.full,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                }}
              >
                <Text
                  style={{
                    fontFamily: 'Roboto_500Medium',
                    fontSize: 10,
                    color: color.textSecondary,
                  }}
                >
                  SLA {job.sla}
                </Text>
              </View>
            </View>

            <Text
              style={{
                fontFamily: 'Roboto_900Black',
                fontSize: 22,
                lineHeight: 28,
                color: color.textPrimary,
                marginBottom: 18,
              }}
            >
              {job.model}
            </Text>

            {/* The committed slot is the single most important fact here — it's
                what acceptance locks the technician into. */}
            <View
              style={{ backgroundColor: color.slotBg, borderRadius: radius.lg, padding: 16 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <Icon name="geo" size={15} color={color.slotFg} />
                <Text
                  style={{
                    fontFamily: 'Roboto_700Bold',
                    fontSize: 11,
                    letterSpacing: 1.2,
                    color: color.slotFg,
                  }}
                >
                  CONFIRMED SLOT
                </Text>
              </View>
              <Text
                style={{
                  fontFamily: 'Roboto_900Black',
                  fontSize: 19,
                  color: color.slotFg,
                  marginTop: 6,
                }}
              >
                {job.slot}
              </Text>
            </View>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: color.surfaceRaised,
                borderWidth: 1,
                borderColor: color.border,
                borderRadius: radius.lg,
                padding: 16,
                marginTop: 12,
              }}
            >
              <Text
                style={{ fontFamily: 'Roboto_500Medium', fontSize: 14, color: color.textSecondary }}
              >
                Payout
              </Text>
              <Text
                style={{ fontFamily: 'Roboto_900Black', fontSize: 22, color: color.credit }}
              >
                {formatPaise(job.payoutPaise)}
              </Text>
            </View>

            <Card style={{ marginTop: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                <Icon name="user" size={14} color={color.textMuted} />
                <Text
                  style={{
                    fontFamily: 'Roboto_700Bold',
                    fontSize: 11,
                    letterSpacing: 1.2,
                    color: color.textMuted,
                  }}
                >
                  DETAILS UNLOCK AFTER YOU ACCEPT
                </Text>
              </View>

              <DetailRow label="Customer" value={job.maskedCustomer} muted first />
              <DetailRow label="Phone" value="+91 ••••• •••••" muted />
              <DetailRow label="Area" value={`${job.area} · ${job.pincode}`} />
              <DetailRow label="Distance" value={job.distanceLabel} />
            </Card>
          </>
        )}
      </Screen>
    </>
  );
}
