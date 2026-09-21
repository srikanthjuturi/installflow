import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import {
  KeyboardFlow,
  ScreenStatusBar,
  TitleBar,
  useKeyboardVisible,
} from '@/components/layout';
import { Button } from '@/components/ui';
import { OtpInput } from '@/features/auth/components/OtpInput';
import { useResendTimer } from '@/features/auth/hooks/useResendTimer';
import { useMe } from '@/features/profile/hooks/useMe';
import { useConfirmDeletion, useSendDeletionCode } from '@/features/profile/hooks/useDeletion';
import { useButtonNavInset } from '@/hooks/useButtonNavInset';
import { useProfileStore } from '@/store/profile.store';
import { useSession } from '@/store/session.store';
import { color } from '@/theme/semantic';

/** "+919876543210" → "+91 98765 43210". */
function prettyPhone(e164: string | undefined): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164 ?? '');
  return m ? `+91 ${m[1]} ${m[2]}` : (e164 ?? '');
}

const CARD = {
  backgroundColor: color.surfaceRaised,
  borderWidth: 1,
  borderColor: color.border,
  borderRadius: 16,
  padding: 18,
} as const;

const BODY = {
  fontFamily: 'Roboto_400Regular',
  fontSize: 13,
  lineHeight: 20,
  color: color.textLabel,
} as const;

/**
 * Profile → Delete account.
 *
 * Google Play requires an in-app way to delete an account a technician
 * created themselves, which is how every invited technician gets one.
 * Proved the same way adding a UPI ID is — a one-time code to the
 * technician's own registered WhatsApp number — and takes effect
 * IMMEDIATELY once verified: no manager approval, because unlike a UPI
 * change this is not money moving, it is the account ending.
 *
 * The server refuses (before a code is even sent) while a job is still
 * open — finishing or reassigning it is on the technician or their manager,
 * not this screen.
 *
 * Net-new copy — the prototype has no delete-account screen at all. Pending
 * sign-off the way Payout Account's was (see `payout.ts`).
 */
export function DeleteAccountScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useMe();

  const sendCode = useSendDeletionCode();
  const confirm = useConfirmDeletion();
  const timer = useResendTimer(30);
  const [code, setCode] = useState('');

  const signOut = useSession((s) => s.signOut);
  const clearAvatar = useProfileStore((s) => s.clearAvatar);

  const sent = sendCode.isSuccess;
  const devCode = sendCode.data?.devCode ?? null;
  const error = confirm.error ?? sendCode.error;

  // "Delete my account" is the last thing here — it must clear the ◁ ○ □ bar.
  // Not while typing: the keyboard is drawn over that bar (see `keyboard.ts`).
  const navInset = useButtonNavInset();
  const keyboardUp = useKeyboardVisible();

  const send = () => {
    setCode('');
    sendCode.mutate(undefined, { onSuccess: () => timer.restart() });
  };

  const deleteNow = () => {
    Alert.alert(
      'Delete your account?',
      'This signs you out right away and removes you from the technician roster. Your past job history and proof stay on record. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            confirm.mutate(code, {
              onSuccess: () => {
                // Same teardown as "Log out" — the account is already gone
                // server-side, so the session has nothing left to hold.
                signOut();
                queryClient.clear();
                clearAvatar();
                router.replace('/(auth)/login');
              },
            }),
        },
      ],
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScreenStatusBar style="dark" />
      <TitleBar title="Delete account" paddingBottom={14} />

      <KeyboardFlow>
        <View style={{ padding: 16, paddingBottom: 40 + (keyboardUp ? 0 : navInset), gap: 14 }}>
          <View style={CARD}>
            <Text style={BODY}>
              Deleting your account signs you out immediately and removes you
              from the technician roster — you stop receiving new job
              offers. Your past job history and proof stay on record for
              warranty and dispute purposes, the same as while your account
              was active.
            </Text>
          </View>

          {sent ? (
            <View style={CARD}>
              <Text style={BODY}>
                We sent a 6-digit code to your WhatsApp, {prettyPhone(me.data?.phone)}
                . Enter it to delete your account.
              </Text>
              <OtpInput value={code} onChange={setCode} />
              <Pressable
                disabled={!timer.canResend || sendCode.isPending}
                onPress={send}
                style={{ marginTop: 14, alignSelf: 'flex-start' }}
              >
                <Text
                  style={{
                    fontFamily: 'Roboto_500Medium',
                    fontSize: 12.5,
                    color: timer.canResend ? color.actionBg : color.textMuted,
                  }}
                >
                  {timer.canResend ? 'Send a new code' : `Send a new code in ${timer.label}`}
                </Text>
              </Pressable>
              {devCode ? <DevCode code={devCode} onUse={() => setCode(devCode)} /> : null}
            </View>
          ) : null}

          {error ? <ErrorLine error={error} /> : null}

          {sent ? (
            <Button
              label="Delete my account"
              variant="destructive"
              loading={confirm.isPending}
              disabled={code.length < 6}
              onPress={deleteNow}
            />
          ) : (
            <Button
              label="Continue"
              variant="dangerOutline"
              loading={sendCode.isPending}
              onPress={send}
            />
          )}
        </View>
      </KeyboardFlow>
    </View>
  );
}

function ErrorLine({ error }: { error: unknown }) {
  return (
    <Text
      style={{
        fontFamily: 'Roboto_400Regular',
        fontSize: 12.5,
        lineHeight: 18,
        color: color.textDanger,
        textAlign: 'center',
        marginTop: 4,
      }}
    >
      {/* The server's own words — it knows why it refused, e.g. an open job. */}
      {error instanceof Error ? error.message : "Couldn't delete your account. Try again."}
    </Text>
  );
}

/**
 * Development only — the server echoes the code when `OTP_DEV_ECHO` is on,
 * the same panel Payout Account, reschedule and joining show.
 */
function DevCode({ code, onUse }: { code: string; onUse: () => void }) {
  return (
    <Pressable
      onPress={onUse}
      style={{
        marginTop: 14,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: color.borderStrong,
        borderRadius: 12,
        padding: 12,
      }}
    >
      <Text style={{ fontFamily: 'Roboto_700Bold', fontSize: 10.5, color: color.textMuted }}>
        DEVELOPMENT ONLY
      </Text>
      <Text
        style={{ fontFamily: 'Roboto_900Black', fontSize: 20, color: color.textPrimary, marginTop: 2 }}
      >
        {code}
      </Text>
    </Pressable>
  );
}
