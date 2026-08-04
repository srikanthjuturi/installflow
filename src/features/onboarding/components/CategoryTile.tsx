import { Pressable, Text, View } from 'react-native';

import { CATEGORY_ICONS, Icon } from '@/components/icons/Icon';
import { palette } from '@/theme/tokens';
import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';
import type { ProductCategory } from '@/types/domain';

export interface CategoryTileProps {
  category: ProductCategory;
  selected: boolean;
  onToggle: () => void;
}

export function CategoryTile({ category, selected, onToggle }: CategoryTileProps) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={category}
      style={{ width: '48%' }}
    >
      {({ pressed }) => (
        <View
          style={{
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: selected ? color.borderFocus : color.border,
            backgroundColor: selected ? palette.primary[50] : color.surfaceRaised,
            padding: 14,
            opacity: pressed ? 0.8 : 1,
          }}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: radius.md,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: selected ? palette.primary[100] : color.surfaceSunken,
              marginBottom: 10,
            }}
          >
            <Icon
              name={CATEGORY_ICONS[category] ?? 'tv'}
              size={22}
              color={selected ? color.actionBg : color.textSecondary}
            />
          </View>

          <Text
            style={{
              fontFamily: 'Roboto_500Medium',
              fontSize: 13,
              lineHeight: 17,
              color: color.textPrimary,
            }}
          >
            {category}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
