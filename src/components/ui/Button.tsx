import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/icons/Icon';
import { color } from '@/theme/semantic';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  /** Sits after the label, e.g. the arrow on "Confirm & continue". */
  trailingIcon?: IconName;
  /**
   * Shown under a disabled button. The prototype always explains WHY an action
   * is unavailable ("Select a reason") rather than leaving a dead control.
   */
  disabledHint?: string;
}

/**
 * Measurements are taken from the prototype, not chosen:
 * primary/destructive are 54px tall at radius 14 with a 16px 700 label;
 * ghost is 46px, transparent, 14px 700.
 */
const HEIGHT: Record<ButtonVariant, number> = {
  primary: 54,
  destructive: 54,
  secondary: 54,
  ghost: 46,
};

const FONT_SIZE: Record<ButtonVariant, number> = {
  primary: 16,
  destructive: 16,
  secondary: 16,
  ghost: 14,
};

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
  trailingIcon,
  disabledHint,
}: ButtonProps) {
  const inert = disabled || loading;
  const bordered = variant === 'secondary';
  const fg = disabled ? color.actionFgDisabled : VARIANT_FG[variant];

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
              flexDirection: 'row',
              height: HEIGHT[variant],
              borderRadius: 14,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              backgroundColor: disabled ? color.actionBgDisabled : VARIANT_BG[variant],
              borderWidth: bordered ? 1 : 0,
              borderColor: color.border,
              opacity: pressed ? 0.85 : 1,
            }}
          >
            {loading ? (
              <ActivityIndicator color={fg} />
            ) : (
              <>
                <Text
                  style={{
                    fontFamily: 'Roboto_700Bold',
                    fontSize: FONT_SIZE[variant],
                    color: fg,
                  }}
                >
                  {label}
                </Text>
                {trailingIcon ? <Icon name={trailingIcon} size={18} color={fg} /> : null}
              </>
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
