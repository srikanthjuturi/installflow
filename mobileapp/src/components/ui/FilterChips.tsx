import { Pressable, ScrollView } from 'react-native';

import { Text } from '@/components/ui/Text';
import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';
import { palette } from '@/theme/tokens';

export interface FilterChipOption<T extends string> {
  value: T;
  label: string;
  /** Drawn after the label. Omit it rather than passing 0 to draw no number. */
  count?: number;
}

export interface FilterChipsProps<T extends string> {
  options: FilterChipOption<T>[];
  value: T;
  onChange: (next: T) => void;
  /**
   * The horizontal padding of the screen this sits in. The row bleeds out by
   * that much so chips scroll to the glass instead of being clipped at the
   * gutter, then pads its content back in so the first chip still lines up.
   */
  gutter?: number;
}

/**
 * A row of toggle chips that scrolls sideways — for filters whose options are
 * DATA, like the pool's categories.
 *
 * Not `SegmentedControl`: that one gives every segment an equal share of a
 * fixed width, which is right for three known words and wrong for a list whose
 * length and wording come from the company's catalogue. Past three categories,
 * or with one long name, it squashes.
 *
 * Fully rounded, which `Pill` deliberately is not. A pill with radius 8 is a
 * label; this is a control, and the shape is how it reads as tappable. The
 * unselected colours are the same chip tint `Pill` and `PincodeChip` use, so it
 * belongs to the family; selected fills with the action colour.
 */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  gutter = 16,
}: FilterChipsProps<T>) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="tablist"
      style={{ marginHorizontal: -gutter, flexGrow: 0 }}
      contentContainerStyle={{ paddingHorizontal: gutter, gap: 8 }}
    >
      {options.map((option) => {
        const active = option.value === value;
        const fg = active ? color.textInverse : color.actionBg;

        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            // 36 drawn, 48 touched. These get tapped standing up, outdoors.
            hitSlop={{ top: 6, bottom: 6 }}
            style={{
              minHeight: 36,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 14,
              borderRadius: radius.full,
              borderWidth: 1,
              backgroundColor: active ? color.actionBg : palette.primary[75],
              borderColor: active ? color.actionBg : palette.primary[200],
            }}
          >
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={1.4}
              style={{ fontFamily: 'Roboto_700Bold', fontSize: 12.5, color: fg }}
            >
              {option.label}
            </Text>
            {option.count !== undefined ? (
              <Text
                maxFontSizeMultiplier={1.4}
                style={{
                  fontFamily: 'Roboto_400Regular',
                  fontSize: 12.5,
                  color: fg,
                  opacity: active ? 0.85 : 0.75,
                }}
              >
                {option.count}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
