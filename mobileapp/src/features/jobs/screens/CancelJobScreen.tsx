import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState, Skeleton } from '@/components/feedback';
import { Icon } from '@/components/icons/Icon';
import { ScreenStatusBar, TitleBar } from '@/components/layout';
import { Button, Text } from '@/components/ui';
import { useCancelJob, useCancellationPreview } from '@/features/jobs/hooks/useCancelJob';
import { errorText } from '@/i18n/errorText';
import { penaltyBandLabel } from '@/i18n/serverLabels';
import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';
import { CANCELLATION_REASONS, type CancellationReason } from '@/types/domain';
import { formatPaise } from '@/utils/money';

export interface CancelJobScreenProps {
  jobId: string;
}

/**
 * What each reason is called on screen. What is POSTED is still the English
 * value from `CANCELLATION_REASONS`: it lands in the ticket's trail, which the
 * console reads in English and ops search by those words.
 */
const REASON_LABEL = {
  'Customer not reachable': 'jobs.cancel.reasons.customerNotReachable',
  'Wrong / incomplete address': 'jobs.cancel.reasons.wrongAddress',
  'Personal emergency': 'jobs.cancel.reasons.personalEmergency',
  'Vehicle breakdown': 'jobs.cancel.reasons.vehicleBreakdown',
  Other: 'jobs.cancel.reasons.other',
} as const satisfies Record<CancellationReason, string>;

/**
 * Screen 8 — Cancel with penalty.
 *
 * Backing out breaks a commitment made on the technician's behalf. The cost
 * leads the screen, and the confirm button repeats the figure so it can never
 * be tapped without having been read.
 *
 * The band, the amount and whether it escalates all come from the SERVER —
 * `GET /jobs/{id}/cancellation` — and this screen renders whatever comes back.
 * That is what makes a job with no agreed time need nothing special here: the
 * server prices it at the cheapest band, because the bands measure lateness
 * against an appointment and nobody has been promised one. The screen never
 * knew the rule, so it cannot get the new case wrong.
 */
export function CancelJobScreen({ jobId }: CancelJobScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [reason, setReason] = useState<CancellationReason>();

  const { data: band, isPending, isError, refetch } = useCancellationPreview(jobId);
  const cancel = useCancelJob(jobId);

  const amount = band ? formatPaise(band.amountPaise) : '—';

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScreenStatusBar style="dark" />
      <TitleBar title={t('jobs.cancel.title')} />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 20 }}
        showsVerticalScrollIndicator={false}
      >
        {isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : (
          <>
            <View
              style={{
                backgroundColor: color.dangerSurface,
                borderWidth: 1,
                borderColor: color.dangerSurfaceBorder,
                borderRadius: 16,
                paddingVertical: 15,
                paddingHorizontal: 16,
                marginBottom: 18,
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                {isPending ? (
                  <View style={{ gap: 6, flex: 1 }}>
                    <Skeleton width={150} height={12} />
                    <Skeleton width={180} height={12} />
                  </View>
                ) : (
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontFamily: 'Roboto_700Bold',
                        fontSize: 12,
                        color: color.dangerTextStrong,
                      }}
                    >
                      {penaltyBandLabel(band.label)}
                    </Text>
                    <Text
                      style={{
                        fontFamily: 'Roboto_400Regular',
                        fontSize: 12,
                        color: color.dangerTextMuted,
                        marginTop: 2,
                      }}
                    >
                      {t('jobs.cancel.deducted')}
                    </Text>
                  </View>
                )}

                <Text
                  style={{ fontFamily: 'Roboto_900Black', fontSize: 26, color: color.debit }}
                >
                  −{amount}
                </Text>
              </View>

              {band?.escalates ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    gap: 8,
                    borderTopWidth: 1,
                    borderTopColor: color.dangerSurfaceBorder,
                    marginTop: 12,
                    paddingTop: 12,
                  }}
                >
                  <View style={{ marginTop: 1 }}>
                    <Icon name="info" size={16} color={color.debit} />
                  </View>
                  <Text
                    style={{
                      flex: 1,
                      fontFamily: 'Roboto_400Regular',
                      fontSize: 12,
                      lineHeight: 17,
                      color: color.dangerTextStrong,
                    }}
                  >
                    {t('jobs.cancel.escalates')}
                  </Text>
                </View>
              ) : null}
            </View>

            <Text
              style={{
                fontFamily: 'Roboto_700Bold',
                fontSize: 12,
                color: color.textLabel,
                marginHorizontal: 2,
                marginBottom: 10,
              }}
            >
              {t('jobs.cancel.why')}
            </Text>

            {CANCELLATION_REASONS.map((option) => {
              const selected = reason === option;

              return (
                <Pressable
                  key={option}
                  onPress={() => setReason(option)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      backgroundColor: color.surfaceRaised,
                      borderWidth: 1.5,
                      borderColor: selected ? color.borderFocus : color.border,
                      borderRadius: 13,
                      paddingVertical: 14,
                      paddingHorizontal: 15,
                      marginBottom: 10,
                    }}
                  >
                    <View
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 11,
                        borderWidth: 2,
                        borderColor: selected ? color.borderFocus : color.borderStrong,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <View
                        style={{
                          width: 11,
                          height: 11,
                          borderRadius: 5.5,
                          backgroundColor: selected ? color.actionBg : 'transparent',
                        }}
                      />
                    </View>

                    <Text
                      style={{
                        fontFamily: 'Roboto_500Medium',
                        fontSize: 14.5,
                        color: color.textPrimary,
                      }}
                    >
                      {t(REASON_LABEL[option])}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
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
        {/* A refusal is the server's sentence, not a generic apology. The one
            that happens — a manager re-assigned the job while this screen was
            open — is not fixed by tapping again, and "something went wrong"
            would send them back to try exactly that. */}
        {cancel.isError ? (
          <Text
            accessibilityRole="alert"
            style={{
              fontFamily: 'Roboto_500Medium',
              fontSize: 12.5,
              lineHeight: 18,
              color: color.debit,
              marginBottom: 10,
            }}
          >
            {cancel.error instanceof Error
              ? errorText(cancel.error, t('jobs.cancel.failed'))
              : t('jobs.cancel.failed')}
          </Text>
        ) : null}

        {/* Blocked state carries the requirement as its label, same as the
            coverage screen — one control, always saying what it needs. */}
        <Button
          label={reason ? t('jobs.cancel.confirm', { amount }) : t('jobs.cancel.selectReason')}
          variant="destructive"
          disabled={!reason || !band}
          loading={cancel.isPending}
          onPress={() => {
            if (!reason) return;
            cancel.mutate(reason, {
              onSuccess: () => router.replace('/(app)/(tabs)/jobs'),
            });
          }}
        />
      </View>
    </View>
  );
}
