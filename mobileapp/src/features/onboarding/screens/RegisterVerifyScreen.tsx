import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KeyboardFlow, ScreenStatusBar } from '@/components/layout';
import { BrandMark, Button, StepDots, Text } from '@/components/ui';
import { saveMyProfilePhoto } from '@/features/auth/api/session';
import { OtpInput } from '@/features/auth/components/OtpInput';
import { useResendTimer } from '@/features/auth/hooks/useResendTimer';
import {
  requestInviteOtp,
  submitRegistration,
  verifyInviteOtp,
} from '@/features/onboarding/api/invite';
import { errorText } from '@/i18n/errorText';
import { ApiError } from '@/lib/api';
import { uploadImage } from '@/lib/uploads';
import { useProfileStore } from '@/store/profile.store';
import {
  REGISTRATION_STEP_COUNT,
  stepNumber,
  useRegistration,
} from '@/store/registration.store';
import { useSession } from '@/store/session.store';
import { color } from '@/theme/semantic';

const OTP_LENGTH = 6;

/**
 * What failed, kept as the failure itself and worded at render — the same
 * reason as on the sign-in screen: a stored sentence would stay in the old
 * language after a switch.
 */
interface Failure {
  error: unknown;
  /** What to say when the failure names nothing more specific. */
  fallback:
    | 'onboarding.verify.errors.sendFailed'
    | 'onboarding.verify.errors.resendFailed'
    | 'onboarding.verify.errors.incomplete'
    | 'onboarding.verify.errors.submitFailed';
}

/** "+919876543210" → "+91 98765 43210". */
function prettyPhone(e164: string): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}

/**
 * The last step of self-registration: prove the phone, then commit everything.
 *
 * The code goes to the number the invite was SENT to, not one the technician
 * types — that is the whole point. A WhatsApp message is forwardable, so
 * without this anyone holding a forwarded link could create an account that
 * accepts jobs and earns money against someone else's number.
 *
 * Nothing has reached the server before this screen. Verifying and registering
 * happen back to back so the entire registration lands in one transaction: an
 * abandoned flow leaves no partial record, and a failure here loses nothing the
 * technician typed — the draft is still on the device.
 */
export function RegisterVerifyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const draft = useRegistration((s) => s.draft);
  const clear = useRegistration((s) => s.clear);
  const signIn = useSession((s) => s.signIn);

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  // Development only — see the note on LoginScreen's DevCode.
  const [devCode, setDevCode] = useState<string | null>(null);
  const { label, canResend, restart } = useResendTimer(30);

  // One code on arrival, and only one: without the ref, a re-render would send
  // another and earn a 429 on the screen's first frame.
  const requested = useRef(false);
  useEffect(() => {
    if (!draft || requested.current) return;
    requested.current = true;
    requestInviteOtp(draft.token)
      .then((r) => setDevCode(r.devCode ?? null))
      .catch(() => {
        setFailure({ error: null, fallback: 'onboarding.verify.errors.sendFailed' });
      });
  }, [draft]);

  if (!draft) {
    router.replace('/(auth)/login');
    return null;
  }

  const submit = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const { registrationToken } = await verifyInviteOtp(draft.token, code);
      const result = await submitRegistration(draft.token, registrationToken, {
        fullName: draft.fullName,
        // Null here even when a photo was cropped: the file has to be uploaded,
        // uploading needs a signed-in principal, and the account does not exist
        // until this call returns. The photo follows immediately below.
        profileImageUrl: null,
        subcategoryIds: draft.subcategoryIds,
        pincodes: draft.pincodes,
        // No UPI ID — joining no longer collects one (and the server ignores
        // it if sent). It is added afterwards on Payout account.
      });

      if (!result.technicianProfile) {
        setFailure({ error: null, fallback: 'onboarding.verify.errors.incomplete' });
        return;
      }

      signIn({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        technician: result.technicianProfile,
      });

      // Now that there is a session, the photo they framed on the profile step
      // can go up. Best-effort on purpose: registration has already succeeded,
      // and a flaky connection must not strand a technician on this screen over
      // a picture they can re-set from Profile at any time.
      const localAvatar = useProfileStore.getState().avatarUri;
      if (localAvatar) {
        try {
          const url = await uploadImage(localAvatar, 'profile');
          await saveMyProfilePhoto(url);
          useProfileStore.getState().setAvatar(url);
        } catch {
          // Keeps the local uri: it is still their photo on this device, and
          // Profile will offer to set it again.
        }
      }
      // Only now — a cleared draft with no session would strand them.
      clear();
      router.replace('/(app)/(tabs)');
    } catch (e) {
      setFailure({ error: e, fallback: 'onboarding.verify.errors.submitFailed' });
    } finally {
      setBusy(false);
    }
  };

  const resend = () => {
    restart();
    setCode('');
    setFailure(null);
    requestInviteOtp(draft.token)
      .then((r) => setDevCode(r.devCode ?? null))
      .catch(() => {
        setFailure({ error: null, fallback: 'onboarding.verify.errors.resendFailed' });
      });
  };

  // A wrong or used-up code is this screen's one 401, and it carries no code.
  const error = !failure
    ? null
    : failure.error instanceof ApiError
      ? errorText(failure.error, t(failure.fallback), {
          401: t('auth.login.errors.wrongCode'),
        })
      : t(failure.fallback);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: color.surfaceRaised,
        paddingTop: insets.top + 12,
        paddingHorizontal: 26,
        paddingBottom: insets.bottom + 26,
      }}
    >
      <ScreenStatusBar style="dark" />

      <View style={{ alignItems: 'flex-end' }}>
        <StepDots total={REGISTRATION_STEP_COUNT} current={stepNumber('verify')} />
      </View>

      <KeyboardFlow>
        <View style={{ marginTop: 18 }}>
          <BrandMark />
        </View>

        <Text
          style={{
            fontFamily: 'Roboto_900Black',
            fontSize: 26,
            letterSpacing: -0.5,
            color: color.textPrimary,
            marginTop: 22,
          }}
        >
          {t('onboarding.verify.title')}
        </Text>

        <Text
          style={{
            fontFamily: 'Roboto_400Regular',
            fontSize: 14,
            lineHeight: 21,
            color: color.textLabel,
            marginTop: 10,
          }}
        >
          <Trans
            i18nKey="onboarding.verify.codeSentTo"
            values={{ phone: prettyPhone(draft.invite.phone) }}
            components={{
              bold: <Text style={{ fontFamily: 'Roboto_700Bold', color: color.textPrimary }} />,
            }}
          />
        </Text>

        <View style={{ marginTop: 20 }}>
          <OtpInput
            value={code}
            onChange={(v) => {
              setCode(v);
              setFailure(null);
            }}
            length={OTP_LENGTH}
          />
        </View>

        <Text
          onPress={canResend && !busy ? resend : undefined}
          style={{
            fontFamily: 'Roboto_400Regular',
            fontSize: 13,
            color: canResend ? color.textLink : color.textMuted,
            marginTop: 16,
          }}
        >
          {canResend ? t('common.resendCode') : t('common.resendCodeIn', { time: label })}
        </Text>

        {error ? (
          <Text
            accessibilityRole="alert"
            style={{
              fontFamily: 'Roboto_500Medium',
              fontSize: 13,
              lineHeight: 19,
              color: color.textDanger,
              marginTop: 14,
            }}
          >
            {error}
          </Text>
        ) : null}

        {devCode ? (
          <Pressable onPress={() => setCode(devCode)} accessibilityRole="button">
            <View
              style={{
                marginTop: 16,
                padding: 12,
                borderRadius: 12,
                borderWidth: 1,
                borderStyle: 'dashed',
                borderColor: color.borderStrong,
                backgroundColor: color.surfaceSunken,
              }}
            >
              <Text
                style={{
                  fontFamily: 'Roboto_700Bold',
                  fontSize: 11,
                  letterSpacing: 0.4,
                  color: color.textMuted,
                }}
              >
                {t('common.devOnly')}
              </Text>
              <Text
                style={{
                  fontFamily: 'RobotoMono_700Bold',
                  fontSize: 22,
                  letterSpacing: 4,
                  color: color.textPrimary,
                  marginTop: 4,
                }}
              >
                {devCode}
              </Text>
              <Text
                style={{
                  fontFamily: 'Roboto_400Regular',
                  fontSize: 12,
                  color: color.textFootnote,
                  marginTop: 2,
                }}
              >
                {t('common.devCodeHint')}
              </Text>
            </View>
          </Pressable>
        ) : null}

        <View style={{ flex: 1 }} />

        <Button
          label={t('onboarding.verify.create')}
          onPress={submit}
          disabled={code.length !== OTP_LENGTH || busy}
          loading={busy}
        />
      </KeyboardFlow>
    </View>
  );
}
