import { Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/icons/Icon';
import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  body?: string;
}

/** Every list screen uses this — an empty list must never render as blank space. */
export function EmptyState({ icon = 'jobs', title, body }: EmptyStateProps) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 }}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: radius.full,
          backgroundColor: color.surfaceSunken,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
        }}
      >
        <Icon name={icon} size={26} color={color.textMuted} />
      </View>

      <Text style={{ fontFamily: 'Roboto_700Bold', fontSize: 15, color: color.textPrimary }}>
        {title}
      </Text>

      {body ? (
        <Text
          style={{
            fontFamily: 'Roboto_400Regular',
            fontSize: 13,
            lineHeight: 19,
            color: color.textSecondary,
            textAlign: 'center',
            marginTop: 6,
          }}
        >
          {body}
        </Text>
      ) : null}
    </View>
  );
}
