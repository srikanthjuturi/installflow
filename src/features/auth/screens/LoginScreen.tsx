import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Screen } from '@/components/layout';
import { BrandMark, Button, Input } from '@/components/ui';
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
 */
export function LoginScreen() {
  const router = useRouter();

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');

  const phoneValid = phone.length === PHONE_LENGTH;

  if (step === 'phone') {
    return (
      <Screen
        footer={
          <>
            <Button label="Send OTP" onPress={() => setStep('otp')} disabled={!phoneValid} />
            <Text
              style={{
                fontFamily: 'Roboto_400Regular',
                fontSize: 12,
                lineHeight: 18,
                color: color.textMuted,
                textAlign: 'center',
                marginTop: 10,
              }}
            >
              By continuing you agree to the partner terms.
            </Text>
          </>
        }
      >
        <View style={{ paddingTop: 72 }}>
          <BrandMark size={56} variant="full" />

          <Text
            style={{
              fontFamily: 'Roboto_900Black',
              fontSize: 25,
              color: color.textPrimary,
              marginTop: 24,
              letterSpacing: -0.5,
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
              marginTop: 6,
              marginBottom: 32,
            }}
          >
            Installation &amp; Demo field partner app.
          </Text>

          <Input
            label="Mobile number"
            value={phone}
            onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, PHONE_LENGTH))}
            placeholder="98765 43210"
            prefix="+91"
            keyboardType="number-pad"
            maxLength={PHONE_LENGTH}
          />
        </View>
      </Screen>
    );
  }

  return <OtpStep phone={phone} code={code} setCode={setCode} onBack={() => setStep('phone')} onVerify={() => router.replace('/(app)/(tabs)')} />;
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
  const codeValid = code.length === OTP_LENGTH;

  const pretty = `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`.trim();

  return (
    <Screen footer={<Button label="Verify & continue" onPress={onVerify} disabled={!codeValid} />}>
      <View style={{ paddingTop: 72 }}>
        <BrandMark size={56} variant="full" />

        <Text
          style={{
            fontFamily: 'Roboto_900Black',
            fontSize: 25,
            color: color.textPrimary,
            marginTop: 24,
            letterSpacing: -0.5,
          }}
        >
          Enter the code
        </Text>

        <Text
          style={{
            fontFamily: 'Roboto_400Regular',
            fontSize: 14,
            lineHeight: 21,
            color: color.textSecondary,
            marginTop: 6,
            marginBottom: 28,
          }}
        >
          Enter the 6-digit code sent to{' '}
          <Text style={{ fontFamily: 'Roboto_500Medium', color: color.textPrimary }}>
            {pretty}
          </Text>
          .{' '}
          <Text onPress={onBack} style={{ fontFamily: 'Roboto_500Medium', color: color.textLink }}>
            Change
          </Text>
        </Text>

        <OtpInput value={code} onChange={setCode} length={OTP_LENGTH} />

        <View style={{ alignItems: 'center', marginTop: 24 }}>
          {canResend ? (
            <Pressable onPress={restart} accessibilityRole="button">
              {({ pressed }) => (
                <Text
                  style={{
                    fontFamily: 'Roboto_500Medium',
                    fontSize: 13,
                    color: color.textLink,
                    opacity: pressed ? 0.6 : 1,
                  }}
                >
                  Resend code
                </Text>
              )}
            </Pressable>
          ) : (
            <Text
              style={{ fontFamily: 'Roboto_400Regular', fontSize: 13, color: color.textMuted }}
            >
              Resend code in {label}
            </Text>
          )}
        </View>
      </View>
    </Screen>
  );
}
