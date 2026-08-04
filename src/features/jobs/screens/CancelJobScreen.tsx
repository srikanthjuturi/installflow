import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ErrorState, Skeleton } from '@/components/feedback';
import { Icon } from '@/components/icons/Icon';
import { Header, Screen } from '@/components/layout';
import { Button, Card } from '@/components/ui';
import { useCancelJob, useCancellationPreview } from '@/features/jobs/hooks/useCancelJob';
import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';
import { CANCELLATION_REASONS, type CancellationReason } from '@/types/domain';
import { formatPaise } from '@/utils/money';

export interface CancelJobScreenProps {
  jobId: string;
}

/**
 * Screen 8 — Cancel with penalty.
 *
 * The customer was promised this slot before any technician saw the job, so
 * backing out breaks a promise someone else made on the technician's behalf.
 * The penalty is shown at full size, before the reason is even picked, because
 * the cost should be the first thing read — not a surprise after confirming.
 */
export function CancelJobScreen({ jobId }: CancelJobScreenProps) {
  const router = useRouter();
  const [reason, setReason] = useState<CancellationReason>();

  const { data: band, isPending, isError, refetch } = useCancellationPreview(jobId);
  const cancel = useCancelJob(jobId);

  const amount = band ? formatPaise(band.amountPaise) : '—';

  return (
    <>
      <Header title="Cancel job" />

      <Screen
        footer={
          <Button
            label={`Cancel & accept −${amount} penalty`}
            variant="destructive"
            disabled={!reason || !band}
            disabledHint="Select a reason"
            loading={cancel.isPending}
            onPress={() => {
              if (!reason) return;
              cancel.mutate(reason, {
                onSuccess: () => router.replace('/(app)/(tabs)/jobs'),
              });
            }}
          />
        }
      >
        {isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : (
          <>
            <Card style={{ marginTop: 16, alignItems: 'center', paddingVertical: 24 }}>
              {isPending ? (
                <View style={{ alignItems: 'center', gap: 10 }}>
                  <Skeleton width={180} height={13} />
                  <Skeleton width={120} height={38} />
                </View>
              ) : (
                <>
                  <Text
                    style={{
                      fontFamily: 'Roboto_500Medium',
                      fontSize: 12.5,
                      color: color.textSecondary,
                    }}
                  >
                    {band.label}
                  </Text>
                  <Text
                    style={{
                      fontFamily: 'Roboto_900Black',
                      fontSize: 40,
                      color: color.debit,
                      marginTop: 8,
                      letterSpacing: -1,
                    }}
                  >
                    −{amount}
                  </Text>
                  <Text
                    style={{
                      fontFamily: 'Roboto_400Regular',
                      fontSize: 12.5,
                      color: color.textMuted,
                      marginTop: 4,
                    }}
                  >
                    Penalty deducted from earnings
                  </Text>
                </>
              )}
            </Card>

            {band?.escalates ? (
              <View
                style={{
                  flexDirection: 'row',
                  gap: 10,
                  backgroundColor: color.slotBg,
                  borderRadius: radius.lg,
                  padding: 14,
                  marginTop: 12,
                }}
              >
                <Icon name="warn" size={18} color={color.slotFg} />
                <Text
                  style={{
                    flex: 1,
                    fontFamily: 'Roboto_500Medium',
                    fontSize: 12.5,
                    lineHeight: 19,
                    color: color.slotFg,
                  }}
                >
                  Under 4 hours to the slot — this escalates straight to the Area Service Manager
                  for urgent reassignment.
                </Text>
              </View>
            ) : null}

            <Text
              style={{
                fontFamily: 'Roboto_900Black',
                fontSize: 17,
                color: color.textPrimary,
                marginTop: 28,
                marginBottom: 12,
              }}
            >
              Why are you cancelling?
            </Text>

            <View style={{ gap: 10 }}>
              {CANCELLATION_REASONS.map((option) => {
                const selected = reason === option;

                return (
                  <Pressable
                    key={option}
                    onPress={() => setReason(option)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                  >
                    {({ pressed }) => (
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 12,
                          borderRadius: radius.md,
                          borderWidth: 1,
                          borderColor: selected ? color.borderFocus : color.border,
                          backgroundColor: color.surfaceRaised,
                          padding: 14,
                          opacity: pressed ? 0.75 : 1,
                        }}
                      >
                        <View
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: radius.full,
                            borderWidth: 2,
                            borderColor: selected ? color.borderFocus : color.borderStrong,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {selected ? (
                            <View
                              style={{
                                width: 10,
                                height: 10,
                                borderRadius: radius.full,
                                backgroundColor: color.actionBg,
                              }}
                            />
                          ) : null}
                        </View>

                        <Text
                          style={{
                            fontFamily: 'Roboto_500Medium',
                            fontSize: 14,
                            color: color.textPrimary,
                          }}
                        >
                          {option}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
      </Screen>
    </>
  );
}
