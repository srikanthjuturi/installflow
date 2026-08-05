import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';

export interface PincodeChipProps {
  code: string;
  onRemove: () => void;
}

/**
 * The code is set in Roboto Mono, matching the prototype. Fixed-width digits
 * make a column of pincodes scannable — a technician checking their coverage
 * is comparing six-digit strings, and proportional digits make that harder
 * than it needs to be.
 */
export function PincodeChip({ code, onRemove }: PincodeChipProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: palette.primary[75],
        borderWidth: 1,
        borderColor: palette.primary[200],
        borderRadius: 999,
        paddingLeft: 12,
        paddingRight: 8,
        paddingVertical: 8,
      }}
    >
      <Icon name="geo" size={14} color={color.actionBg} strokeWidth={1.9} />

      <Text
        style={{
          fontFamily: 'RobotoMono_700Bold',
          fontSize: 13,
          color: color.actionBg,
        }}
      >
        {code}
      </Text>

      <Pressable
        onPress={onRemove}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`Remove pincode ${code}`}
      >
        {({ pressed }) => (
          <View
            style={{
              width: 18,
              height: 18,
              borderRadius: 9,
              backgroundColor: palette.primary[150],
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.6 : 1,
            }}
          >
            <Icon name="close" size={10} color={color.actionBg} />
          </View>
        )}
      </Pressable>
    </View>
  );
}
