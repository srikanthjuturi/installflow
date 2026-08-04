import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { Pill } from '@/components/ui';
import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';
import type { Job } from '@/types/domain';
import { formatPaise } from '@/utils/money';

export interface PoolJobCardProps {
  job: Job;
  onPress: () => void;
}

/**
 * The pool card — the inverse of Home's.
 *
 * Here the PRODUCT leads and the customer is absent entirely, because this is
 * a decision about whether to commit: what am I installing, how far, when, for
 * how much. Identity is withheld until acceptance (doc §6).
 *
 * The payout and the slot sit together below a rule, since those are the two
 * facts being weighed against each other.
 */
export function PoolJobCard({ job, onPress }: PoolJobCardProps) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      {({ pressed }) => (
        <View
          style={{
            backgroundColor: color.surfaceRaised,
            borderWidth: 1,
            borderColor: pressed ? palette.neutral[300] : color.border,
            borderRadius: 18,
            padding: 15,
            marginBottom: 13,
            shadowColor: palette.neutral[900],
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.04,
            shadowRadius: 2,
            elevation: 1,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pill label={job.category} tone="primary" />
              <Pill label={`SLA ${job.sla}`} tone="secondary" />
            </View>

            <Text
              style={{
                fontFamily: 'RobotoMono_400Regular',
                fontSize: 11,
                color: color.textMuted,
              }}
            >
              {job.id}
            </Text>
          </View>

          <Text
            style={{
              fontFamily: 'Roboto_700Bold',
              fontSize: 15.5,
              color: color.textPrimary,
              marginTop: 11,
              marginBottom: 3,
            }}
          >
            {job.model}
          </Text>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              marginBottom: 12,
            }}
          >
            <Icon name="geo" size={14} color={color.textMuted} />
            <Text
              style={{
                fontFamily: 'Roboto_400Regular',
                fontSize: 12.5,
                color: color.textLabel,
              }}
            >
              {job.area} · {job.pincode} · {job.distanceLabel}
            </Text>
          </View>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderTopWidth: 1,
              borderTopColor: color.surface,
              paddingTop: 12,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 }}>
              <Icon name="clock" size={16} color={palette.secondary[500]} />
              <Text
                style={{ fontFamily: 'Roboto_700Bold', fontSize: 13.5, color: color.slotFg }}
                numberOfLines={1}
              >
                {job.slot}
              </Text>
            </View>

            <Text
              style={{ fontFamily: 'Roboto_900Black', fontSize: 16, color: color.textPrimary }}
            >
              {formatPaise(job.payoutPaise)}
            </Text>
          </View>
        </View>
      )}
    </Pressable>
  );
}
