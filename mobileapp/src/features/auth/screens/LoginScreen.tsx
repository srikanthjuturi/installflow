import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandMark, Button } from '@/components/ui';
import { OtpInput } from '@/features/auth/components/OtpInput';
import { useResendTimer } from '@/features/auth/hooks/useResendTimer';
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

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');

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

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
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
          <PhoneStep phone={phone} setPhone={setPhone} onNext={() => setStep('otp')} />
        ) : (
          <OtpStep
            phone={phone}
            code={code}
            setCode={setCode}
            onBack={() => setStep('phone')}
            onVerify={() => router.replace('/(app)/(tabs)')}
          />
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

interface PhoneStepProps {
  phone: string;
  setPhone: (next: string) => void;
  onNext: () => void;
}

function PhoneStep({ phone, setPhone, onNext }: PhoneStepProps) {
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
      <View style={{ flex: 1 }} />

      <Button label="Send OTP" onPress={onNext} disabled={!valid} />

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
}

function OtpStep({ phone, code, setCode, onBack, onVerify }: OtpStepProps) {
  // Hook lives here rather than in LoginScreen so the countdown starts when the
  // OTP step mounts, not when the screen first renders.
  const { label, canResend, restart } = useResendTimer(24);
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
        onPress={canResend ? restart : undefined}
        style={{
          fontFamily: 'Roboto_400Regular',
          fontSize: 13,
          color: canResend ? color.textLink : color.textMuted,
          marginTop: 16,
        }}
      >
        {canResend ? 'Resend code' : `Resend code in ${label}`}
      </Text>

      <View style={{ flex: 1 }} />

      <Button label="Verify & continue" onPress={onVerify} disabled={!valid} />
    </>
  );
}
