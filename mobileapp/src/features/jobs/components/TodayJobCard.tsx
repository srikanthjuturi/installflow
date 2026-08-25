import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';
import type { Job } from '@/types/domain';

export interface TodayJobCardProps {
  job: Job;
  onPress: () => void;
}

function badge(job: Job) {
  if (job.status === 'completed') return { label: 'Completed', ...color.statusCompleted };
  if (job.status === 'inprogress') return { label: 'In progress', ...color.statusInProgress };
  if (job.hoursToSlot <= 4) return { label: 'Starting soon', ...color.statusStartingSoon };
  return { label: 'Upcoming', ...color.statusUpcoming };
}

/**
 * Home's job card.
 *
 * Leads with the CUSTOMER, not the product — this list is "who am I visiting
 * today", and by this point the technician has already committed to the job.
 * The pool card is the opposite: there the product and payout are the decision
 * and the customer is still masked.
 */
export function TodayJobCard({ job, onPress }: TodayJobCardProps) {
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

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name="clock" size={15} color={palette.secondary[500]} />
              <Text
                numberOfLines={1}
                maxFontSizeMultiplier={1.4}
                style={{ fontFamily: 'Roboto_700Bold', fontSize: 12.5, color: color.slotFg }}
              >
                {job.slotShort}
              </Text>
            </View>
          </View>

          {/* The customer's name is NOT capped and NOT truncated to one line:
              it is who the technician is about to visit, and a name that has
              been cut in half is worse than a taller card. */}
          <Text
            style={{ fontFamily: 'Roboto_700Bold', fontSize: 16, color: color.textPrimary }}
          >
            {job.customer ?? job.maskedCustomer}
          </Text>
          <Text
            style={{
              fontFamily: 'Roboto_400Regular',
              fontSize: 13,
              color: color.textLabel,
              marginTop: 2,
            }}
        >
            {job.model} · {job.area}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
