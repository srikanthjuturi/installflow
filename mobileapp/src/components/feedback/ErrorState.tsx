import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';

export interface ErrorStateProps {
  title?: string;
  body?: string;
  onRetry?: () => void;
  /**
   * For inside a card, where a full-screen failure would swamp the rest of the
   * screen: tight padding, a smaller glyph, a ghost retry.
   */
  compact?: boolean;
}

export function ErrorState({ title, body, onRetry, compact = false }: ErrorStateProps) {
  const { t } = useTranslation();

  return (
    <View
      style={{
        alignItems: 'center',
        paddingVertical: compact ? 8 : 48,
        paddingHorizontal: compact ? 0 : 24,
      }}
    >
      <View
        style={{
          width: compact ? 40 : 56,
          height: compact ? 40 : 56,
          borderRadius: radius.full,
          backgroundColor: color.statusCancelled.bg,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: compact ? 10 : 16,
        }}
      >
        <Icon name="warn" size={compact ? 20 : 26} color={color.debit} />
      </View>

      <Text style={{ fontFamily: 'Roboto_700Bold', fontSize: 15, color: color.textPrimary }}>
        {title ?? t('components.errorState.title')}
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
        {body ?? t('components.errorState.body')}
      </Text>

      {onRetry ? (
        <View style={{ marginTop: compact ? 12 : 20, alignSelf: 'stretch' }}>
          <Button label={t('common.tryAgain')} variant="secondary" onPress={onRetry} />
        </View>
      ) : null}
    </View>
  );
}
