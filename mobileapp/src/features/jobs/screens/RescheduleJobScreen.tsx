import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { Icon } from '@/components/icons/Icon';
import { ScreenStatusBar, TitleBar } from '@/components/layout';
import { Button } from '@/components/ui';
import { OtpInput } from '@/features/auth/components/OtpInput';
import { useResendTimer } from '@/features/auth/hooks/useResendTimer';
import type { SlotOption } from '@/features/jobs/api/reschedule';
import { useJob } from '@/features/jobs/hooks/useJobs';
import {
  useRescheduleJob,
  useRescheduleSlots,
  useSendRescheduleCode,
} from '@/features/jobs/hooks/useReschedule';
import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';

export interface RescheduleJobScreenProps {
  jobId: string;
}

/**
 * Reschedule — pick a new window, then the customer's code.
 *
 * ⚠ **NET-NEW. Every string on this screen needs sign-off.** The approved
 * prototype has sixteen screens, login through profile, and not one of them
 * moves a time — its cancel screen is the only exit from a job, and the
 * console's own prototype says the opposite of this feature outright ("Slot
 * confirmed & locked"). Nothing here was pulled from an approved source, which
 * hard rule 6 says to flag rather than quietly invent. Same convention as
 * `NoShowDialog` on the console side.
 *
 * ## Why the code goes to the customer
 *
 * The technician is standing at the door and the customer has just said "come
 * Thursday". Their agreement is the whole justification for moving a time they
 * chose before any technician saw the job — so the server WhatsApps THEM six
 * digits and the technician types back what they are told. Refuse to give it
 * and nothing moves; the cancel screen is still there, unchanged, and still
 * charges the band.
 *
 * ## Two steps, one screen
 *
 * Deliberately not two routes. The technician is holding a phone in somebody's
 * doorway, and the window they picked has to stay on screen while the customer
 * reads out the code — a second screen would either lose it or have to repeat
 * it back.
 */
export function RescheduleJobScreen({ jobId }: RescheduleJobScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: job } = useJob(jobId);
  const { data: slots, isPending, isError, refetch } = useRescheduleSlots(jobId);

  const [picked, setPicked] = useState<string>();
  const [code, setCode] = useState('');

  const sendCode = useSendRescheduleCode(jobId);
  const reschedule = useRescheduleJob(jobId);
  const timer = useResendTimer(30);

  const sent = sendCode.isSuccess;
  const devCode = sendCode.data?.devCode ?? null;
  // Whether the cooldown applies. Two halves, and both are needed:
  //
  //   * `everSent` survives `sendCode.reset()`, which is called when the
  //     technician picks a different window — the mutation is cleared but the
  //     customer's phone has still had a message, and the server's throttle is
  //     per NUMBER, not per screen state;
  //   * without it the timer alone would be wrong at the other end, because
  //     `useResendTimer` starts counting the moment this screen mounts and
  //     would disable the very first send for thirty seconds.
  const [everSent, setEverSent] = useState(false);
  const cooling = everSent && !timer.canResend;

  // Grouped by day, in the order the server sent them — soonest first, which is
  // already the order somebody reads a day plan in.
  const days = useMemo(() => {
    const out: { day: string; options: SlotOption[] }[] = [];
    for (const option of slots ?? []) {
      const last = out[out.length - 1];
      if (last && last.day === option.day) last.options.push(option);
      else out.push({ day: option.day, options: [option] });
    }
    return out;
  }, [slots]);

  const failure = reschedule.error ?? sendCode.error;

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScreenStatusBar style="dark" />
      <TitleBar title="Reschedule visit" />

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
                backgroundColor: color.surfaceRaised,
                borderWidth: 1,
                borderColor: color.border,
                borderRadius: 16,
                paddingVertical: 14,
                paddingHorizontal: 16,
                marginBottom: 18,
              }}
            >
              <Text
                style={{
                  fontFamily: 'Roboto_700Bold',
                  fontSize: 12,
                  color: color.textLabel,
                }}
              >
                Currently booked
              </Text>
              <Text
                style={{
                  fontFamily: 'Roboto_500Medium',
                  fontSize: 15,
                  color: color.textPrimary,
                  marginTop: 3,
                }}
              >
                {job?.slot ?? '—'}
              </Text>
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
              Pick a new time with the customer
            </Text>

            {isPending ? (
              <View style={{ gap: 10 }}>
                <Skeleton width="100%" height={52} />
                <Skeleton width="100%" height={52} />
                <Skeleton width="100%" height={52} />
              </View>
            ) : days.length === 0 ? (
              // A real answer, not an error: the next two days are full. The
              // honest remedy is a manager's, not this screen's.
              <EmptyState
                icon="calendar"
                title="No times available"
                body="Your next two days are fully booked. Call your Area Service Manager — they can move this job to another technician."
              />
            ) : (
              days.map((group) => (
                <View key={group.day} style={{ marginBottom: 6 }}>
                  <Text
                    style={{
                      fontFamily: 'Roboto_700Bold',
                      fontSize: 11.5,
                      color: color.textMuted,
                      marginHorizontal: 2,
                      marginBottom: 8,
                      marginTop: 4,
                    }}
                  >
                    {group.day.toUpperCase()}
                  </Text>

                  {group.options.map((option) => {
                    const selected = picked === option.startIso;

                    return (
                      <Pressable
                        key={option.startIso}
                        // Changing the window after a code has been sent must
                        // invalidate that code in the technician's head as well
                        // as ours: the customer agreed to a specific time, so a
                        // code obtained for Thursday must not book Friday.
                        // Clearing what they typed is what makes that visible.
                        onPress={() => {
                          if (option.startIso === picked) return;
                          setPicked(option.startIso);
                          // The code was minted FOR the old window and the
                          // server will not accept it for this one — the
                          // customer agreed to a time, not to a change. So the
                          // digits go, and the technician has to ask again.
                          if (sent) {
                            setCode('');
                            sendCode.reset();
                          }
                        }}
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
                              borderColor: selected
                                ? color.borderFocus
                                : color.borderStrong,
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <View
                              style={{
                                width: 11,
                                height: 11,
                                borderRadius: 5.5,
                                backgroundColor: selected
                                  ? color.actionBg
                                  : 'transparent',
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
                            {option.time}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ))
            )}

            {sent ? (
              <View
                style={{
                  borderTopWidth: 1,
                  borderTopColor: palette.neutral[200],
                  marginTop: 10,
                  paddingTop: 18,
                }}
              >
                <Text
                  style={{
                    fontFamily: 'Roboto_700Bold',
                    fontSize: 12,
                    color: color.textLabel,
                    marginHorizontal: 2,
                    marginBottom: 6,
                  }}
                >
                  Ask the customer for their code
                </Text>
                <Text
                  style={{
                    fontFamily: 'Roboto_400Regular',
                    fontSize: 12.5,
                    lineHeight: 18,
                    color: color.textMuted,
                    marginHorizontal: 2,
                    marginBottom: 14,
                  }}
                >
                  We have sent a 6-digit code to the customer on WhatsApp. Ask
                  them to read it out — it confirms they agreed to the new time.
                </Text>

                <OtpInput value={code} onChange={setCode} />

                <Pressable
                  disabled={!timer.canResend || sendCode.isPending || !picked}
                  onPress={() => {
                    if (!picked) return;
                    setCode('');
                    sendCode.mutate(picked, {
                onSuccess: () => {
                  setEverSent(true);
                  timer.restart();
                },
              });
                  }}
                  style={{ marginTop: 14, alignSelf: 'flex-start' }}
                >
                  <Text
                    style={{
                      fontFamily: 'Roboto_500Medium',
                      fontSize: 12.5,
                      color: timer.canResend ? color.actionBg : color.textMuted,
                    }}
                  >
                    {timer.canResend
                      ? 'Send a new code'
                      : `Send a new code in ${timer.label}`}
                  </Text>
                </Pressable>

                <Text
                  style={{
                    fontFamily: 'Roboto_400Regular',
                    fontSize: 11.5,
                    lineHeight: 17,
                    color: color.textMuted,
                    marginTop: 6,
                    marginHorizontal: 2,
                  }}
                >
                  Sending a new code cancels the previous one.
                </Text>

                {devCode ? (
                  // Development only. The customer's phone is not one you can
                  // read from here, so without this the flow is untestable
                  // until WhatsApp delivery is live — the same panel, for the
                  // same reason, as the self-registration screen.
                  <Pressable
                    onPress={() => setCode(devCode)}
                    style={{
                      marginTop: 14,
                      borderWidth: 1,
                      borderStyle: 'dashed',
                      borderColor: color.borderStrong,
                      borderRadius: 12,
                      padding: 12,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: 'Roboto_700Bold',
                        fontSize: 10.5,
                        color: color.textMuted,
                      }}
                    >
                      DEVELOPMENT ONLY
                    </Text>
                    <Text
                      style={{
                        fontFamily: 'Roboto_900Black',
                        fontSize: 20,
                        color: color.textPrimary,
                        marginTop: 2,
                      }}
                    >
                      {devCode}
                    </Text>
                    <Text
                      style={{
                        fontFamily: 'Roboto_400Regular',
                        fontSize: 11.5,
                        color: color.textMuted,
                        marginTop: 2,
                      }}
                    >
                      Tap to fill. Not shown once WhatsApp delivery is live.
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
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
        {failure ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 8,
              marginBottom: 10,
            }}
          >
            <View style={{ marginTop: 1 }}>
              <Icon name="info" size={15} color={color.debit} />
            </View>
            <Text
              accessibilityRole="alert"
              style={{
                flex: 1,
                fontFamily: 'Roboto_500Medium',
                fontSize: 12.5,
                lineHeight: 18,
                color: color.debit,
              }}
            >
              {failure instanceof Error
                ? failure.message
                : 'Could not update the time. Check your connection and try again.'}
            </Text>
          </View>
        ) : null}

        {sent ? (
          <Button
            label="Confirm new time"
            disabled={!picked || code.length < 6}
            loading={reschedule.isPending}
            onPress={() => {
              if (!picked) return;
              reschedule.mutate(
                { startIso: picked, code },
                { onSuccess: () => router.back() },
              );
            }}
          />
        ) : (
          /* The cooldown is per PHONE NUMBER and outlives this screen's state,
             so changing the window after a code went out does not reset it. The
             button used to offer "Send code" again straight away and earn a 429
             the technician could do nothing about; it now says how long, which
             is the same thing the login screen's resend line does. */
          <Button
            label={
              !picked
                ? 'Pick a time'
                : cooling
                  ? `Send code in ${timer.label}`
                  : 'Send code to the customer'
            }
            disabled={!picked || cooling}
            loading={sendCode.isPending}
            onPress={() => {
              if (!picked) return;
              sendCode.mutate(picked, {
                onSuccess: () => {
                  setEverSent(true);
                  timer.restart();
                },
              });
            }}
          />
        )}
      </View>
    </View>
  );
}
