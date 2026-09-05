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
 *
 * `hoursToSlot` is null when no time has been agreed — a job can be accepted
 * before the customer picks one. That gets its own label rather than falling
 * through to "Upcoming": the two look identical on a card and mean opposite
 * things about what the technician has to do next. Upcoming is settled and
 * waiting; this one is waiting on somebody.
 */
export interface StatusBadgeProps {
  status: JobStatus;
  hoursToSlot: number | null;
}

function resolve(status: JobStatus, hoursToSlot: number | null) {
  if (status === 'completed') return { label: 'Completed', ...color.statusCompleted };
  if (status === 'cancelled') return { label: 'Cancelled', ...color.statusCancelled };
  if (status === 'inprogress') return { label: 'In progress', ...color.statusInProgress };
  // Before the ≤4h test, because `null <= 4` is TRUE in JavaScript — null
  // coerces to 0 — and a job with no time at all would have announced itself
  // as "Starting soon".
  if (hoursToSlot === null) return { label: 'Awaiting time', ...color.statusUpcoming };
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
