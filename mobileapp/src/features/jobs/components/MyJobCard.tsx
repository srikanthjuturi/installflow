import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';
import type { Job } from '@/types/domain';

export interface MyJobCardProps {
  job: Job;
  onPress: () => void;
}

function badge(job: Job) {
  if (job.status === 'completed') return { label: 'Completed', ...color.statusCompleted };
  if (job.status === 'cancelled') return { label: 'Cancelled', ...color.statusCancelled };
  if (job.status === 'inprogress') return { label: 'In progress', ...color.statusInProgress };
  if (job.hoursToSlot <= 4) return { label: 'Starting soon', ...color.statusStartingSoon };
  return { label: 'Upcoming', ...color.statusUpcoming };
}

/**
 * The My-jobs card. Close to Home's but not identical, and the differences
 * are deliberate rather than incidental:
 *
 *   - the job id shows here, because this list is where a technician looks a
 *     job up; Home is just "today"
 *   - the full slot rather than the short form, since this list spans days
 *   - a trailing chevron, because every row leads somewhere
 *
 * Status stays a fully-round pill (999) while metadata elsewhere uses r8, so
 * state and attributes never blur together when scanning.
 */
export function MyJobCard({ job, onPress }: MyJobCardProps) {
  const status = badge(job);

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
            marginBottom: 12,
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
              marginBottom: 9,
            }}
        >
            <View
              style={{
                backgroundColor: status.bg,
                borderRadius: 999,
                paddingHorizontal: 10,
                paddingVertical: 4,
              }}
            >
              <Text
                numberOfLines={1}
                maxFontSizeMultiplier={1.4}
                style={{ fontFamily: 'Roboto_700Bold', fontSize: 11, color: status.fg }}
              >
                {status.label}
              </Text>
            </View>

            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={1.4}
              style={{
                fontFamily: 'RobotoMono_400Regular',
                fontSize: 11,
                color: color.textMuted,
              }}
            >
              {job.code ?? job.id}
            </Text>
          </View>

          <Text style={{ fontFamily: 'Roboto_700Bold', fontSize: 16, color: color.textPrimary }}>
            {job.customer ?? job.maskedCustomer}
          </Text>
          <Text
            style={{
              fontFamily: 'Roboto_400Regular',
              fontSize: 13,
              color: color.textLabel,
              marginTop: 2,
              marginBottom: 11,
            }}
        >
            {job.model}
          </Text>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderTopWidth: 1,
              borderTopColor: color.surface,
              paddingTop: 10,
            }}
        >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 }}>
              <Icon name="clock" size={15} color={palette.secondary[500]} />
              <Text
                style={{ fontFamily: 'Roboto_700Bold', fontSize: 13, color: color.slotFg }}
                numberOfLines={1}
              >
                {job.slot}
              </Text>
            </View>

            <Icon name="chevronRight" size={20} color={color.textMuted} />
          </View>
        </View>
      )}
    </Pressable>
  );
}
