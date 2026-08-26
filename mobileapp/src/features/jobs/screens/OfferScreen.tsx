import { useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState, Skeleton } from '@/components/feedback';
import { ScreenStatusBar } from '@/components/layout';
import { Icon } from '@/components/icons/Icon';
import { Button, Pill } from '@/components/ui';
import { useOffer } from '@/features/jobs/hooks/useJobs';
import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';
import { formatPaise } from '@/utils/money';

export interface OfferScreenProps {
  jobId: string;
}

/**
 * Screen 5 — Job offer, masked.
 *
 * Shows exactly enough to decide — slot, payout, area, distance — and nothing
 * that identifies the customer. That boundary is doc §6 and it is deliberate:
 * releasing names and numbers to every eligible technician for every open job
 * would leak customer data across the entire workforce.
 */
export function OfferScreen({ jobId }: OfferScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: job, isPending, isError, refetch } = useOffer(jobId);

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScreenStatusBar style="light" />

      <View
        style={{
          backgroundColor: color.chrome,
          paddingTop: insets.top + 6,
          paddingHorizontal: 16,
          paddingBottom: 20,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 44 }}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back to pool"
          >
            {({ pressed }) => (
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: pressed ? color.chromeControl : 'transparent',
                }}
              >
                <Icon name="chevronLeft" size={24} color={color.textInverse} />
              </View>
            )}
          </Pressable>

          {/* The prototype ends this row with a mono identifier on the right.
              It is deliberately not rendered: bound to the real API that field
              is `job.id`, a UUID, which is a route param and means nothing to
              a technician. `job.code` (RGT-INST-0001) is the human-readable one
              if this ever comes back. */}
          <Text
            style={{ fontFamily: 'Roboto_700Bold', fontSize: 17, color: color.textInverse }}
          >
            Job offer
          </Text>
        </View>

        {job ? (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
            <Pill label={job.category} tone="chromePrimary" />
            <Pill label={`SLA ${job.sla}`} tone="chromeSecondary" />
          </View>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 20 }}
        showsVerticalScrollIndicator={false}
      >
        {isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : isPending ? (
          <View style={{ gap: 14 }}>
            <Skeleton width="100%" height={150} rounded={18} />
            <Skeleton width="100%" height={220} rounded={18} />
          </View>
        ) : (
          <>
            <View
              style={{
                backgroundColor: color.surfaceRaised,
                borderWidth: 1,
                borderColor: color.border,
                borderRadius: 18,
                padding: 18,
                marginBottom: 14,
              }}
            >
              <Text
                style={{ fontFamily: 'Roboto_700Bold', fontSize: 16, color: color.textPrimary }}
              >
                {job.model}
              </Text>

              {/* Slot and payout share ONE block: the technician is trading a
                  fixed time for a fixed fee, so the two facts belong together
                  rather than in separate cards. */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  backgroundColor: color.slotBlockBg,
                  borderWidth: 1,
                  borderColor: color.slotBlockBorder,
                  borderRadius: 12,
                  paddingVertical: 12,
                  paddingHorizontal: 13,
                  marginTop: 14,
                }}
              >
                <Icon name="clock" size={20} color={palette.secondary[500]} />

                <View>
                  <Text
                    style={{
                      fontFamily: 'Roboto_700Bold',
                      fontSize: 10,
                      letterSpacing: 0.8,
                      textTransform: 'uppercase',
                      color: palette.secondary[600],
                    }}
                  >
                    Confirmed slot
                  </Text>
                  <Text
                    style={{ fontFamily: 'Roboto_700Bold', fontSize: 15, color: color.slotFg }}
                  >
                    {job.slot}
                  </Text>
                </View>

                <View style={{ marginLeft: 'auto', alignItems: 'flex-end' }}>
                  <Text
                    style={{
                      fontFamily: 'Roboto_400Regular',
                      fontSize: 10,
                      color: color.slotBlockLabel,
                    }}
                  >
                    Payout
                  </Text>
                  <Text
                    style={{ fontFamily: 'Roboto_900Black', fontSize: 17, color: color.slotFg }}
                  >
                    {formatPaise(job.payoutPaise)}
                  </Text>
                </View>
              </View>
            </View>

            <View
              style={{
                backgroundColor: color.surfaceRaised,
                borderWidth: 1,
                borderColor: color.border,
                borderRadius: 18,
                padding: 18,
                marginBottom: 14,
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 7,
                  marginBottom: 12,
                }}
              >
                <Icon name="lock" size={16} color={color.textMuted} />
                <Text
                  style={{
                    fontFamily: 'Roboto_700Bold',
                    fontSize: 11,
                    letterSpacing: 0.66,
                    textTransform: 'uppercase',
                    color: color.textFootnote,
                  }}
                >
                  Details unlock after you accept
                </Text>
              </View>

              <MaskedRow label="Customer" value={job.maskedCustomer} masked first />
              <MaskedRow label="Phone" value="+91 •••••  •••••" masked />
              <MaskedRow label="Area" value={`${job.area} · ${job.pincode}`} />
              {/* Dropped entirely when there is nothing to measure — nothing
                  stores the customer's coordinates, so a real job has no
                  distance. An empty row reads as a missing value; no row reads
                  as a fact we do not carry. */}
              {job.distanceLabel ? (
                <MaskedRow label="Distance" value={job.distanceLabel} />
              ) : null}
            </View>
          </>
        )}
      </ScrollView>

      <View
        style={{
          backgroundColor: color.surfaceRaised,
          borderTopWidth: 1,
          borderTopColor: palette.neutral[200],
          paddingTop: 12,
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 16,
        }}
      >
        <Button
          label="Accept job"
          trailingIcon="arrowRight"
          onPress={() => router.push(`/accept-slot?jobId=${jobId}`)}
          disabled={!job}
        />
        <View style={{ marginTop: 4 }}>
          <Button label="Pass" variant="ghost" onPress={() => router.back()} />
        </View>
      </View>
    </View>
  );
}

interface MaskedRowProps {
  label: string;
  value: string;
  masked?: boolean;
  first?: boolean;
}

function MaskedRow({ label, value, masked = false, first = false }: MaskedRowProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 9,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: palette.neutral[100],
        gap: 16,
      }}
    >
      <Text style={{ fontFamily: 'Roboto_400Regular', fontSize: 13, color: color.textSecondary }}>
        {label}
      </Text>
      <Text
        style={{
          fontFamily: 'Roboto_700Bold',
          fontSize: 13,
          color: masked ? color.textMasked : color.textPrimary,
          letterSpacing: masked ? 0.65 : 0,
          flexShrink: 1,
          textAlign: 'right',
        }}
      >
        {value}
      </Text>
    </View>
  );
}
