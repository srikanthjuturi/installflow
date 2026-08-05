import { Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { Button } from '@/components/ui/Button';
import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';

export interface ErrorStateProps {
  title?: string;
  body?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = 'Something went wrong',
  body = "We couldn't load this. Check your connection and try again.",
  onRetry,
}: ErrorStateProps) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 }}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: radius.full,
          backgroundColor: color.statusCancelled.bg,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
        }}
      >
        <Icon name="warn" size={26} color={color.debit} />
      </View>

      <Text style={{ fontFamily: 'Roboto_700Bold', fontSize: 15, color: color.textPrimary }}>
        {title}
      </Text>
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

      {onRetry ? (
        <View style={{ marginTop: 20, alignSelf: 'stretch' }}>
          <Button label="Try again" variant="secondary" onPress={onRetry} />
        </View>
      ) : null}
    </View>
  );
}
