import { Pressable, Text, View } from 'react-native';

import { CATEGORY_ICONS, Icon } from '@/components/icons/Icon';
import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';
import type { ProductCategory } from '@/types/domain';

export interface CategoryTileProps {
  category: ProductCategory;
  selected: boolean;
  onToggle: () => void;
}

/**
 * Two-up tile.
 *
 * The prototype sizes these `calc(50% - 6px)` against a 12px gap. React Native
 * has no calc and adds `gap` ON TOP of a percentage width, so `50%` + gap
 * overflows the row and every tile wraps onto its own line. The equivalent is
 * a half-width cell with 6px of horizontal padding, against a parent pulled
 * out by -6 — outer edges stay flush, inner gutter lands at exactly 12.
 *
 * The 2px border is load-bearing: selection shows as border colour AND a check
 * badge, because a 1px tint is easy to miss in daylight — and mis-setting this
 * list means never being offered the right work.
 */
export function CategoryTile({ category, selected, onToggle }: CategoryTileProps) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={category}
      style={{ width: '50%', paddingHorizontal: 6, marginBottom: 12 }}
    >
      {({ pressed }) => (
        <View
          style={{
            borderWidth: 2,
            borderColor: selected ? color.actionBg : color.border,
            backgroundColor: selected ? palette.primary[50] : color.surfaceRaised,
            borderRadius: 16,
            paddingVertical: 16,
            paddingHorizontal: 14,
            opacity: pressed ? 0.85 : 1,
          }}
        >
          <View
            style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              backgroundColor: selected ? palette.primary[100] : color.surfaceSunken,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon
              name={CATEGORY_ICONS[category] ?? 'tv'}
              size={24}
              color={selected ? color.actionBg : color.textSecondary}
            />
          </View>

          <Text
            style={{
              fontFamily: 'Roboto_700Bold',
              fontSize: 14,
              lineHeight: 17,
              color: color.textPrimary,
              marginTop: 12,
            }}
          >
            {category}
          </Text>

          {selected ? (
            <View
              style={{
                position: 'absolute',
                top: 12,
                right: 12,
                width: 22,
                height: 22,
                borderRadius: 11,
                backgroundColor: color.actionBg,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="check" size={13} color={color.actionFg} />
            </View>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}
