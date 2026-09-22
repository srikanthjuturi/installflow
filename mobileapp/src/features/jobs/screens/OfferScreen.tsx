import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState, Skeleton } from '@/components/feedback';
import { ScreenStatusBar } from '@/components/layout';
import { Icon } from '@/components/icons/Icon';
import { Button, Pill, Text } from '@/components/ui';
import { jobSlaPill, jobSlot } from '@/features/jobs/format';
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
  const { t } = useTranslation();
  const { data: job, isError, refetch } = useOffer(jobId);

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
            accessibilityLabel={t('jobs.offer.back')}
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
            {t('jobs.offer.title')}
          </Text>
        </View>

        {job ? (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
            <Pill label={job.category} tone="chromePrimary" />
            <Pill label={jobSlaPill(job)} tone="chromeSecondary" />
          </View>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 20 }}
        showsVerticalScrollIndicator={false}
      >
        {/* The offer first, the error only when there is no offer to show.
            A refetch that fails keeps the last good answer, and one ALWAYS
            fails the moment this technician accepts: the job has left the
            pool, so `GET /jobs/pool/:id` 404s. `pool.changed` fires that
            refetch at commit, before the accept response has even arrived,
            so error-first painted "check your connection" under the sheet
            until the job opened. */}
        {job ? (
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

                {/* `flex: 1` so the slot takes what the payout leaves and WRAPS
                    into it. Without it this column sized to its text, and a
                    long window — "Tue, 8 Sept · 11:00 AM–1:00 PM", or any
                    slot at a large system font — pushed the payout out past the
                    block's edge. Wrapped, not truncated: the technician is
                    deciding on this time, so all of it has to be readable. */}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    style={{
                      fontFamily: 'Roboto_700Bold',
                      fontSize: 10,
                      letterSpacing: 0.8,
                      textTransform: 'uppercase',
                      color: palette.secondary[600],
                    }}
                  >
                    {/* The label has to match the value under it. "Confirmed
                        slot" over "Time not set yet" reads as a contradiction,
                        and the technician is deciding from this block. Second
                        string not yet approved. */}
                    {job.hoursToSlot === null ? t('jobs.offer.slot') : t('jobs.offer.confirmedSlot')}
                  </Text>
                  <Text
                    style={{ fontFamily: 'Roboto_700Bold', fontSize: 15, color: color.slotFg }}
                  >
                    {jobSlot(job)}
                  </Text>
                </View>

                {/* Never shrinks: the money is the one thing here that must
                    never be cut or pushed off the card. */}
                <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
                  <Text
                    style={{
                      fontFamily: 'Roboto_400Regular',
                      fontSize: 10,
                      color: color.slotBlockLabel,
                    }}
                  >
                    {t('jobs.offer.payout')}
                  </Text>
                  <Text
                    style={{ fontFamily: 'Roboto_900Black', fontSize: 17, color: color.slotFg }}
                  >
                    {formatPaise(job.payoutPaise)}
                  </Text>
                  {/* Repeated from the pool card on purpose. This is the last
                      screen before the accept sheet, and a number that changed
                      the technician's mind on the list must still be in front
                      of them when they commit. */}
                  {job.bonusPaise !== null && (
                    <Text
                      style={{
                        fontFamily: 'Roboto_700Bold',
                        fontSize: 12.5,
                        color: palette.secondary[600],
                        marginTop: 1,
                      }}
                    >
                      {t('jobs.bonus', { amount: formatPaise(job.bonusPaise) })}
                    </Text>
                  )}
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
                  {t('jobs.offer.detailsLocked')}
                </Text>
              </View>

              <MaskedRow label={t('jobs.offer.customer')} value={job.maskedCustomer} masked first />
              <MaskedRow label={t('jobs.offer.phone')} value="+91 •••••  •••••" masked />
              <MaskedRow label={t('jobs.offer.area')} value={`${job.area} · ${job.pincode}`} />
              {/* Dropped entirely when there is nothing to measure — nothing
                  stores the customer's coordinates, so a real job has no
                  distance. An empty row reads as a missing value; no row reads
                  as a fact we do not carry. */}
              {job.distanceLabel ? (
                <MaskedRow label={t('jobs.offer.distance')} value={job.distanceLabel} />
              ) : null}
            </View>
          </>
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : (
          <View style={{ gap: 14 }}>
            <Skeleton width="100%" height={150} rounded={18} />
            <Skeleton width="100%" height={220} rounded={18} />
          </View>
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
          label={t('jobs.offer.accept')}
          trailingIcon="arrowRight"
          onPress={() => router.push(`/accept-slot?jobId=${jobId}`)}
          disabled={!job}
        />
        <View style={{ marginTop: 4 }}>
          <Button label={t('jobs.offer.pass')} variant="ghost" onPress={() => router.back()} />
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
