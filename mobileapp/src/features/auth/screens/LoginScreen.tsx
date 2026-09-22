import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { BackHandler, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KeyboardFlow, ScreenStatusBar, useKeyboardReveal } from '@/components/layout';
import { BrandMark, Button, Text } from '@/components/ui';
import { OtpInput } from '@/features/auth/components/OtpInput';
import { useResendTimer } from '@/features/auth/hooks/useResendTimer';
import { requestOtp, verifyOtp } from '@/features/auth/api/session';
import { LanguagePill } from '@/features/language/components/LanguagePill';
import { useLanguagePrompt } from '@/features/language/hooks/useLanguagePrompt';
import { errorText } from '@/i18n/errorText';
import { ApiError } from '@/lib/api';
import { useSession } from '@/store/session.store';
import { color } from '@/theme/semantic';

const OTP_LENGTH = 6;
const PHONE_LENGTH = 10;

type Step = 'phone' | 'otp';

/**
 * What failed, kept as the failure itself rather than its sentence: `errorText`
 * words it at render, so switching language here rewords an error that is
 * already showing — which is exactly when somebody who cannot read the English
 * one reaches for the language button.
 */
interface Failure {
  error: unknown;
  /** What to say when the failure names nothing more specific. */
  fallback:
    | 'auth.login.errors.sendFailed'
    | 'auth.login.errors.verifyFailed'
    | 'auth.login.errors.notTechnician';
}

/**
 * Screen 1 — sign-in.
 *
 * OTP only. There is no password anywhere in this product, which is why there
 * is no "forgot password" route: the phone number IS the credential.
 *
 * Layout from the prototype: white page at 34/26/26, the same dark 58px tile
 * as the invite screen, and a CTA pushed to the bottom by `margin-top:auto`
 * rather than pinned in a bordered footer.
 */
export function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  // The first screen most people ever see, so the first place the language
  // list may open by itself.
  useLanguagePrompt();

  const signIn = useSession((s) => s.signIn);

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  const send = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await requestOtp('+91' + phone);
      setCode('');
      setStep('otp');
    } catch (e) {
      setFailure({ error: e, fallback: 'auth.login.errors.sendFailed' });
    } finally {
      setBusy(false);
    }
  };

  /**
   * Android back, handled explicitly.
   *
   * This is the FIRST screen, so there is nothing behind it — React Navigation
   * logs a red "GO_BACK was not handled by any navigator" box every time, which
   * reads like a crash and is the loudest thing in the dev console. From the
   * OTP step back belongs to the flow (return to the number); from the phone
   * step it belongs to the OS (leave the app).
   *
   * Only while this screen is FOCUSED. React Native asks the newest listener
   * first, and this one used to stay registered under the language sheet — so
   * Back on the sheet left the app instead of closing the sheet.
   */
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (step === 'otp') {
          setStep('phone');
          setFailure(null);
          return true;
        }
        BackHandler.exitApp();
        return true;
      });
      return () => sub.remove();
    }, [step]),
  );

  const verify = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const result = await verifyOtp('+91' + phone, code);
      if (!result.technicianProfile) {
        // A real account, but not a technician one — or one whose onboarding
        // never completed. Signing them in would land them on a Home screen
        // with nothing behind it.
        setFailure({ error: null, fallback: 'auth.login.errors.notTechnician' });
        return;
      }
      signIn({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        technician: result.technicianProfile,
      });
      router.replace('/(app)/(tabs)');
    } catch (e) {
      setFailure({ error: e, fallback: 'auth.login.errors.verifyFailed' });
    } finally {
      setBusy(false);
    }
  };

  // Sign-in's errors carry no code, but here each status means one thing: a
  // 401 is a wrong or used-up code, a 403 a disabled account, a 404 a number
  // with no technician behind it. A 429 is `errorText`'s own "too many".
  const error = !failure
    ? null
    : failure.error instanceof ApiError
      ? errorText(failure.error, t(failure.fallback), {
          401: t('auth.login.errors.wrongCode'),
          403: t('auth.login.errors.disabled'),
          404: t('auth.login.errors.noAccount'),
        })
      : t(failure.fallback);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: color.surfaceRaised,
        paddingTop: insets.top + 34,
        paddingHorizontal: 26,
        paddingBottom: insets.bottom + 26,
      }}
    >
      <ScreenStatusBar style="dark" />

      <KeyboardFlow>
        {/* The language button shares the tile's row, top-aligned, so the
            approved layout below it does not move. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
          }}
        >
          <BrandMark />
          <LanguagePill />
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
          {t('auth.login.title')}
        </Text>
        <Text
          style={{
            fontFamily: 'Roboto_400Regular',
            fontSize: 14,
            lineHeight: 21,
            color: color.textSecondary,
            marginTop: 7,
          }}
        >
          {t('auth.login.subtitle')}
        </Text>

        {step === 'phone' ? (
          <PhoneStep
            phone={phone}
            setPhone={(v) => {
              setPhone(v);
              setFailure(null);
            }}
            onNext={send}
            busy={busy}
            error={error}
          />
        ) : (
          <OtpStep
            phone={phone}
            code={code}
            setCode={(v) => {
              setCode(v);
              setFailure(null);
            }}
            onBack={() => {
              setStep('phone');
              setFailure(null);
            }}
            onVerify={verify}
            onResend={send}
            busy={busy}
            error={error}
          />
        )}
      </KeyboardFlow>
    </View>
  );
}

interface PhoneStepProps {
  phone: string;
  setPhone: (next: string) => void;
  onNext: () => void;
  busy: boolean;
  error: string | null;
}

function PhoneStep({ phone, setPhone, onNext, busy, error }: PhoneStepProps) {
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  // A bare TextInput rather than `Input`, so it reports focus to the flow
  // itself — see KeyboardFlow.
  const reveal = useKeyboardReveal();
  const valid = phone.length === PHONE_LENGTH;

  return (
    <>
      <Text
        style={{
          fontFamily: 'Roboto_700Bold',
          fontSize: 12,
          color: color.textLabel,
          marginTop: 34,
        }}
      >
        {t('auth.login.mobileNumber')}
      </Text>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          height: 56,
          borderWidth: 1.5,
          borderColor: focused ? color.borderFocus : color.borderStrong,
          borderRadius: 13,
          paddingHorizontal: 14,
          marginTop: 8,
        }}
      >
        <Text
          style={{ fontFamily: 'Roboto_700Bold', fontSize: 16, color: color.textPrimary }}
        >
          +91
        </Text>

        <View style={{ width: 1, height: 24, backgroundColor: color.border }} />

        <TextInput
          value={phone}
          onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, PHONE_LENGTH))}
          onFocus={() => {
            setFocused(true);
            reveal();
          }}
          onBlur={() => setFocused(false)}
          placeholder="98765 43210"
          placeholderTextColor={color.textMuted}
          keyboardType="phone-pad"
          maxLength={PHONE_LENGTH}
          style={{
            flex: 1,
            fontFamily: 'Roboto_500Medium',
            fontSize: 17,
            letterSpacing: 0.7,
            color: color.textPrimary,
            padding: 0,
          }}
        />
      </View>

      {/* `margin-top:auto` in the prototype — the CTA sits at the bottom of the
          page, not in a bordered footer bar. */}
      {error ? <FormError message={error} /> : null}

      <View style={{ flex: 1 }} />

      <Button
        label={t('auth.login.sendOtp')}
        onPress={onNext}
        disabled={!valid || busy}
        loading={busy}
      />

      <Text
        style={{
          fontFamily: 'Roboto_400Regular',
          fontSize: 12,
          color: color.textMuted,
          textAlign: 'center',
          marginTop: 12,
        }}
      >
        {t('auth.login.terms')}
      </Text>
    </>
  );
}

interface OtpStepProps {
  phone: string;
  code: string;
  setCode: (next: string) => void;
  onBack: () => void;
  onVerify: () => void;
  onResend: () => void;
  busy: boolean;
  error: string | null;
}

function OtpStep({
  phone,
  code,
  setCode,
  onBack,
  onVerify,
  onResend,
  busy,
  error,
}: OtpStepProps) {
  const { t } = useTranslation();
  // Hook lives here rather than in LoginScreen so the countdown starts when the
  // OTP step mounts, not when the screen first renders. 30s matches the
  // server's resend throttle — a shorter timer would only earn a 429.
  const { label, canResend, restart } = useResendTimer(30);
  const valid = code.length === OTP_LENGTH;

  const pretty = `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`.trim();

  return (
    <>
      <Text
        style={{
          fontFamily: 'Roboto_400Regular',
          fontSize: 14,
          lineHeight: 21,
          color: color.textLabel,
          marginTop: 34,
        }}
      >
        <Trans
          i18nKey="auth.login.codeSentTo"
          values={{ phone: pretty }}
          components={{
            bold: <Text style={{ fontFamily: 'Roboto_700Bold', color: color.textPrimary }} />,
            change: (
              <Text
                onPress={onBack}
                style={{ fontFamily: 'Roboto_700Bold', color: color.textLink }}
              />
            ),
          }}
        />
      </Text>

      <View style={{ marginTop: 20 }}>
        <OtpInput value={code} onChange={setCode} length={OTP_LENGTH} />
      </View>

      <Text
        onPress={
          canResend && !busy
            ? () => {
                restart();
                onResend();
              }
            : undefined
        }
        style={{
          fontFamily: 'Roboto_400Regular',
          fontSize: 13,
          color: canResend ? color.textLink : color.textMuted,
          marginTop: 16,
        }}
      >
        {canResend ? t('common.resendCode') : t('common.resendCodeIn', { time: label })}
      </Text>

      {error ? <FormError message={error} /> : null}

      <View style={{ flex: 1 }} />

      <Button
        label={t('auth.login.verify')}
        onPress={onVerify}
        disabled={!valid || busy}
        loading={busy}
      />
    </>
  );
}

/**
 * A failure the technician can act on, shown in the flow rather than in a
 * toast — "that code did not match" is only useful beside the boxes it refers
 * to.
 */
function FormError({ message }: { message: string }) {
  return (
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
      {message}
    </Text>
  );
}

