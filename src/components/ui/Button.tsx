import * as Haptics from 'expo-haptics';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Icon, type IconName } from '@/components/icons/Icon';
import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'destructive'
  /** Transparent with red text — "Cancel this job". */
  | 'dangerGhost'
  /** White with a blue outline — the Call / Navigate pair. */
  | 'outline';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  /** Sits after the label, e.g. the arrow on "Confirm & continue". */
  trailingIcon?: IconName;
  /** Sits before the label — the play glyph on "Start job", Call/Navigate. */
  leadingIcon?: IconName;
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
  dangerGhost: 46,
  outline: 46,
};

/** Full-size CTAs are r14; the smaller inline controls are r12. */
const RADIUS: Record<ButtonVariant, number> = {
  primary: 14,
  destructive: 14,
  secondary: 14,
  ghost: 14,
  dangerGhost: 12,
  outline: 12,
};

const FONT_SIZE: Record<ButtonVariant, number> = {
  primary: 16,
  destructive: 16,
  secondary: 16,
  ghost: 14,
  dangerGhost: 14,
  outline: 14,
};

const VARIANT_BG: Record<ButtonVariant, string> = {
  primary: color.actionBg,
  secondary: color.surfaceRaised,
  ghost: 'transparent',
  destructive: color.debit,
  dangerGhost: 'transparent',
  outline: color.surfaceRaised,
};

const VARIANT_FG: Record<ButtonVariant, string> = {
  primary: color.actionFg,
  secondary: color.textPrimary,
  ghost: color.textSecondary,
  destructive: color.actionFg,
  dangerGhost: color.debit,
  outline: color.actionBg,
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  trailingIcon,
  leadingIcon,
  disabledHint,
}: ButtonProps) {
  const inert = disabled || loading;
  const bordered = variant === 'secondary' || variant === 'outline';
  const fg = disabled ? color.actionFgDisabled : VARIANT_FG[variant];

  // Spring-back press, not an opacity flash. On the low-end Androids these
  // technicians carry, a physical-feeling button reads as more responsive than
  // it actually is — worth the few lines.
  const scale = useSharedValue(1);
  const dim = useSharedValue(0);
  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: 1 - dim.value * 0.12,
  }));

  const pressIn = () => {
    scale.value = withSpring(0.975, { damping: 18, stiffness: 320 });
    dim.value = withTiming(1, { duration: 90 });
  };

  const pressOut = () => {
    scale.value = withSpring(1, { damping: 14, stiffness: 260 });
    dim.value = withTiming(0, { duration: 140 });
  };

  const handlePress = () => {
    // Gloves and noisy sites — touch confirmation matters more here than usual.
    Haptics.impactAsync(
      variant === 'destructive'
        ? Haptics.ImpactFeedbackStyle.Heavy
        : Haptics.ImpactFeedbackStyle.Light,
    ).catch(() => {
      /* unsupported device — never block the tap */
    });
    onPress?.();
  };

  return (
    <View>
      <Pressable
        onPress={inert ? undefined : handlePress}
        onPressIn={inert ? undefined : pressIn}
        onPressOut={inert ? undefined : pressOut}
        disabled={inert}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: inert, busy: loading }}
      >
        <Animated.View
          style={[
            {
              flexDirection: 'row',
              height: HEIGHT[variant],
              borderRadius: RADIUS[variant],
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              backgroundColor: disabled ? color.actionBgDisabled : VARIANT_BG[variant],
              borderWidth: bordered ? (variant === 'outline' ? 1.5 : 1) : 0,
              borderColor: variant === 'outline' ? palette.primary[200] : color.border,
            },
            animated,
          ]}
        >
          {loading ? (
            <ActivityIndicator color={fg} />
          ) : (
            <>
              {leadingIcon ? (
                <Icon name={leadingIcon} size={variant === 'primary' ? 20 : 17} color={fg} />
              ) : null}
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
        </Animated.View>
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
