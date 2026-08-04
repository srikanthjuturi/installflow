import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  /**
   * Shown under a disabled button. The prototype always explains WHY an action
   * is unavailable ("Select a reason") rather than leaving a dead control —
   * keep that behaviour.
   */
  disabledHint?: string;
}

const VARIANT_BG: Record<ButtonVariant, string> = {
  primary: color.actionBg,
  secondary: color.surfaceRaised,
  ghost: 'transparent',
  destructive: color.debit,
};

const VARIANT_FG: Record<ButtonVariant, string> = {
  primary: color.actionFg,
  secondary: color.textPrimary,
  ghost: color.textSecondary,
  destructive: color.actionFg,
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  disabledHint,
}: ButtonProps) {
  const inert = disabled || loading;
  const bordered = variant === 'secondary';

  return (
    <View>
      <Pressable
        onPress={inert ? undefined : onPress}
        disabled={inert}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: inert, busy: loading }}
      >
        {({ pressed }) => (
          <View
            style={{
              height: 52,
              borderRadius: radius.xl,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: disabled ? color.actionBgDisabled : VARIANT_BG[variant],
              borderWidth: bordered ? 1 : 0,
              borderColor: color.border,
              opacity: pressed ? 0.85 : 1,
            }}
          >
            {loading ? (
              <ActivityIndicator color={VARIANT_FG[variant]} />
            ) : (
              <Text
                style={{
                  fontFamily: 'Roboto_700Bold',
                  fontSize: 16,
                  color: disabled ? color.actionFgDisabled : VARIANT_FG[variant],
                }}
              >
                {label}
              </Text>
            )}
          </View>
        )}
      </Pressable>

      {disabled && disabledHint ? (
        <Text
          style={{
            fontFamily: 'Roboto_400Regular',
            fontSize: 12,
            color: color.textMuted,
            textAlign: 'center',
            marginTop: 8,
          }}
        >
          {disabledHint}
        </Text>
      ) : null}
    </View>
  );
}
