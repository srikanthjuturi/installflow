import { useRef } from 'react';
import { Pressable, TextInput, View, Text } from 'react-native';

import { palette } from '@/theme/tokens';
import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';

export interface OtpInputProps {
  value: string;
  onChange: (next: string) => void;
  length?: number;
  autoFocus?: boolean;
}

/**
 * Six boxes backed by one hidden TextInput.
 *
 * Six separate inputs is the obvious approach and it's wrong on Android:
 * per-box focus juggling fights autofill and the SMS retriever, and backspace
 * across boxes is unreliable. One field keeps OTP autofill working; the boxes
 * are presentation only.
 */
export function OtpInput({ value, onChange, length = 6, autoFocus = true }: OtpInputProps) {
  const inputRef = useRef<TextInput>(null);
  const cells = Array.from({ length }, (_, i) => value[i] ?? '');

  return (
    <Pressable onPress={() => inputRef.current?.focus()} accessibilityLabel="One-time code">
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {cells.map((digit, i) => {
          const filled = digit !== '';
          const active = i === value.length;

          return (
            <View
              key={i}
              style={{
                flex: 1,
                height: 56,
                borderRadius: radius.md,
                borderWidth: filled || active ? 1.5 : 1,
                borderColor: filled || active ? color.borderFocus : color.border,
                backgroundColor: filled ? palette.primary[50] : color.surfaceRaised,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text
                style={{ fontFamily: 'Roboto_900Black', fontSize: 22, color: color.textPrimary }}
              >
                {digit}
              </Text>
            </View>
          );
        })}
      </View>

      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={(v) => onChange(v.replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={length}
        autoFocus={autoFocus}
        caretHidden
        style={{ position: 'absolute', opacity: 0, height: 56, width: '100%' }}
      />
    </Pressable>
  );
}
