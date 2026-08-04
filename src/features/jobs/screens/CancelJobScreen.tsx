import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState, Skeleton } from '@/components/feedback';
import { Icon } from '@/components/icons/Icon';
import { TitleBar } from '@/components/layout';
import { Button } from '@/components/ui';
import { useCancelJob, useCancellationPreview } from '@/features/jobs/hooks/useCancelJob';
import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';
import { CANCELLATION_REASONS, type CancellationReason } from '@/types/domain';
import { formatPaise } from '@/utils/money';

export interface CancelJobScreenProps {
  jobId: string;
}

/**
 * Screen 8 — Cancel with penalty.
 *
 * The customer was promised this slot before any technician saw the job, so
 * backing out breaks a commitment made on the technician's behalf. The cost
 * leads the screen, and the confirm button repeats the figure so it can never
 * be tapped without having been read.
 */
export function CancelJobScreen({ jobId }: CancelJobScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<CancellationReason>();

  const { data: band, isPending, isError, refetch } = useCancellationPreview(jobId);
  const cancel = useCancelJob(jobId);

  const amount = band ? formatPaise(band.amountPaise) : '—';

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <StatusBar style="dark" />
      <TitleBar title="Cancel job" />

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
                      {band.label}
                    </Text>
                    <Text
                      style={{
                        fontFamily: 'Roboto_400Regular',
                        fontSize: 12,
                        color: color.dangerTextMuted,
                        marginTop: 2,
                      }}
                    >
                      Penalty deducted from earnings
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
                    Under 4 hours to the slot — this escalates straight to the Area Service
                    Manager for urgent reassignment.
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
              Why are you cancelling?
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
                      {option}
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
        {/* Blocked state carries the requirement as its label, same as the
            coverage screen — one control, always saying what it needs. */}
        <Button
          label={reason ? `Cancel & accept −${amount} penalty` : 'Select a reason'}
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
