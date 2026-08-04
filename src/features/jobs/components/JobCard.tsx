import { Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { Card, StatusBadge } from '@/components/ui';
import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';
import type { Job } from '@/types/domain';
import { formatPaise } from '@/utils/money';

export interface JobCardProps {
  job: Job;
  onPress?: () => void;
  /**
   * `pool` shows payout and distance to help the decision to accept.
   * `mine` shows the committed slot and the customer, since the job is already
   * won and what matters is turning up.
   */
  variant?: 'pool' | 'mine';
}

export function JobCard({ job, onPress, variant = 'mine' }: JobCardProps) {
  const pool = variant === 'pool';

  return (
    <Card onPress={onPress} style={{ marginBottom: 12 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
        }}
      >
        {pool ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text
              style={{ fontFamily: 'Roboto_700Bold', fontSize: 12, color: color.textPrimary }}
            >
              {job.category}
            </Text>
            <View
              style={{
                backgroundColor: color.surfaceSunken,
                borderRadius: radius.full,
                paddingHorizontal: 8,
                paddingVertical: 3,
              }}
            >
              <Text
                style={{ fontFamily: 'Roboto_500Medium', fontSize: 10, color: color.textSecondary }}
              >
                SLA {job.sla}
              </Text>
            </View>
          </View>
        ) : (
          <StatusBadge status={job.status} hoursToSlot={job.hoursToSlot} />
        )}

        <Text style={{ fontFamily: 'Roboto_500Medium', fontSize: 11, color: color.textMuted }}>
          {job.id}
        </Text>
      </View>

      <Text
        style={{
          fontFamily: 'Roboto_700Bold',
          fontSize: 15,
          lineHeight: 20,
          color: color.textPrimary,
        }}
      >
        {job.model}
      </Text>

      <Text
        style={{
          fontFamily: 'Roboto_400Regular',
          fontSize: 13,
          color: color.textSecondary,
          marginTop: 2,
        }}
      >
        {pool ? `${job.area} · ${job.pincode}` : (job.customer ?? job.maskedCustomer)}
      </Text>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 12,
          paddingTop: 12,
          borderTopWidth: 1,
          borderTopColor: color.border,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
          <Icon name="geo" size={15} color={color.slotFg} />
          <Text
            style={{ fontFamily: 'Roboto_500Medium', fontSize: 12.5, color: color.slotFg }}
            numberOfLines={1}
          >
            {job.slot}
          </Text>
        </View>

        <Text
          style={{ fontFamily: 'Roboto_900Black', fontSize: 15, color: color.textPrimary }}
        >
          {pool ? formatPaise(job.payoutPaise) : job.distanceLabel}
        </Text>
      </View>
    </Card>
  );
}
