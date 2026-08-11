import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { BackHandler, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KeyboardFlow } from '@/components/layout';
import { BrandMark, Button } from '@/components/ui';
import { OtpInput } from '@/features/auth/components/OtpInput';
import { useResendTimer } from '@/features/auth/hooks/useResendTimer';
import { requestOtp, verifyOtp } from '@/features/auth/api/session';
import { ApiError } from '@/lib/api';
import { useSession } from '@/store/session.store';
import { color } from '@/theme/semantic';

const OTP_LENGTH = 6;
const PHONE_LENGTH = 10;

type Step = 'phone' | 'otp';

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

  const signIn = useSession((s) => s.signIn);

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await requestOtp('+91' + phone);
      setCode('');
      setStep('otp');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send a code. Try again.');
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
   */
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step === 'otp') {
        setStep('phone');
        setError(null);
        return true;
      }
      BackHandler.exitApp();
      return true;
    });
    return () => sub.remove();
  }, [step]);

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await verifyOtp('+91' + phone, code);
      if (!result.technicianProfile) {
        // A real account, but not a technician one — or one whose onboarding
        // never completed. Signing them in would land them on a Home screen
        // with nothing behind it.
        setError('This number is not set up as a technician yet.');
        return;
      }
      signIn({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        technician: result.technicianProfile,
      });
      router.replace('/(app)/(tabs)');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  };

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
      <StatusBar style="dark" />

      <KeyboardFlow>
        <BrandMark />

        <Text
          style={{
            fontFamily: 'Roboto_900Black',
            fontSize: 26,
            letterSpacing: -0.5,
            color: color.textPrimary,
            marginTop: 22,
          }}
        >
          Technician sign-in
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
          Installation &amp; Demo field partner app.
        </Text>

        {step === 'phone' ? (
          <PhoneStep
            phone={phone}
            setPhone={(v) => {
              setPhone(v);
              setError(null);
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
              setError(null);
            }}
            onBack={() => {
              setStep('phone');
              setError(null);
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
  const [focused, setFocused] = useState(false);
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
        Mobile number
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
          onFocus={() => setFocused(true)}
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

      <Button label="Send OTP" onPress={onNext} disabled={!valid || busy} loading={busy} />

      <Text
        style={{
          fontFamily: 'Roboto_400Regular',
          fontSize: 12,
          color: color.textMuted,
          textAlign: 'center',
          marginTop: 12,
        }}
      >
        By continuing you agree to the partner terms.
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
        Enter the 6-digit code sent to{' '}
        <Text style={{ fontFamily: 'Roboto_700Bold', color: color.textPrimary }}>{pretty}</Text>.{' '}
        <Text
          onPress={onBack}
          style={{ fontFamily: 'Roboto_700Bold', color: color.textLink }}
        >
          Change
        </Text>
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
        {canResend ? 'Resend code' : `Resend code in ${label}`}
      </Text>

      {error ? <FormError message={error} /> : null}

      <View style={{ flex: 1 }} />

      <Button
        label="Verify & continue"
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

