import { Text, View } from 'react-native';

import { color } from '@/theme/semantic';

export interface DetailRowProps {
  label: string;
  value: string;
  /** Hides the separator on the first row of a group. */
  first?: boolean;
  /** Masked values render muted, signalling "unlocks after you accept". */
  muted?: boolean;
}

/** Label-left / value-right row used by the invite, offer and detail screens. */
export function DetailRow({ label, value, first = false, muted = false }: DetailRowProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 13,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: color.border,
        gap: 16,
      }}
    >
      <Text style={{ fontFamily: 'Roboto_400Regular', fontSize: 13, color: color.textSecondary }}>
        {label}
      </Text>
      <Text
        style={{
          fontFamily: 'Roboto_500Medium',
          fontSize: 14,
          color: muted ? color.textMuted : color.textPrimary,
          flexShrink: 1,
          textAlign: 'right',
        }}
      >
        {value}
      </Text>
    </View>
  );
}
