import { Text, View } from 'react-native';

import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';
import type { JobStatus } from '@/types/domain';

/**
 * Resolves a job's badge itself rather than taking a label + colour, so the
 * "Starting soon" rule (≤4h to the committed slot) lives in exactly one place.
 * That threshold is the same one a cancellation escalates on — under it the
 * job goes straight to the Area Service Manager. The penalty AMOUNT is a
 * company rule and is never assumed here; the server sends it.
 */
export interface StatusBadgeProps {
  status: JobStatus;
  hoursToSlot: number;
}

function resolve(status: JobStatus, hoursToSlot: number) {
  if (status === 'completed') return { label: 'Completed', ...color.statusCompleted };
  if (status === 'cancelled') return { label: 'Cancelled', ...color.statusCancelled };
  if (status === 'inprogress') return { label: 'In progress', ...color.statusInProgress };
  if (hoursToSlot <= 4) return { label: 'Starting soon', ...color.statusStartingSoon };
  return { label: 'Upcoming', ...color.statusUpcoming };
}

export function StatusBadge({ status, hoursToSlot }: StatusBadgeProps) {
  const { label, fg, bg } = resolve(status, hoursToSlot);

  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: bg,
        borderRadius: radius.full,
        paddingHorizontal: 10,
        paddingVertical: 4,
      }}
    >
      <Text style={{ fontFamily: 'Roboto_700Bold', fontSize: 11, color: fg }}>{label}</Text>
    </View>
  );
}
