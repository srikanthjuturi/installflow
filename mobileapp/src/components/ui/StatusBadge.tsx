import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';
import type { Job } from '@/types/domain';

/**
 * Resolves a job's badge itself rather than taking a label + colour, so the
 * "Starting soon" rule (≤4h to the committed slot) lives in exactly one place —
 * `jobBadge` below, which Home's and My jobs' cards call too. That threshold is
 * the same one a cancellation escalates on — under it the job goes straight to
 * the Area Service Manager. The penalty AMOUNT is a company rule and is never
 * assumed here; the server sends it.
 *
 * No agreed time gets its own label rather than falling through to "Upcoming":
 * the two look identical on a card and mean opposite things about what the
 * technician has to do next. Upcoming is settled and waiting; this one is
 * waiting on somebody.
 */
export interface StatusBadgeProps {
  job: BadgeJob;
}

type BadgeJob = Pick<Job, 'status' | 'slotStart' | 'slotEnd'>;

const STARTING_SOON_MS = 4 * 3_600_000;

/**
 * Measured from the slot's instants against the clock NOW, not from
 * `hoursToSlot`. That number is taken when the list is fetched and held in the
 * query cache, so a list loaded at 6:59 for a 7:00 slot would go on saying
 * "Starting soon" all morning.
 *
 * "Slot closed" is measured from the END of the window, the same edge the
 * server's no-show sweep and the console's escalation queue use: while the
 * window is open the technician is late, and late is not absent. The job stays
 * `Assigned` — and on Upcoming — because a technician can still go late; it is
 * only the badge that must stop promising the slot is ahead of them. Before
 * this branch every past slot read "Starting soon", since a negative number of
 * hours is always ≤ 4.
 */
export function jobBadge(job: BadgeJob, now: number = Date.now()) {
  if (job.status === 'completed') return { label: 'completed', ...color.statusCompleted } as const;
  if (job.status === 'cancelled') return { label: 'cancelled', ...color.statusCancelled } as const;
  if (job.status === 'inprogress') return { label: 'inProgress', ...color.statusInProgress } as const;
  if (!job.slotStart) return { label: 'awaitingTime', ...color.statusUpcoming } as const;
  const start = Date.parse(job.slotStart);
  const end = job.slotEnd ? Date.parse(job.slotEnd) : start;
  if (end <= now) return { label: 'slotClosed', ...color.statusSlotClosed } as const;
  if (start - now <= STARTING_SOON_MS) return { label: 'startingSoon', ...color.statusStartingSoon } as const;
  return { label: 'upcoming', ...color.statusUpcoming } as const;
}

export function StatusBadge({ job }: StatusBadgeProps) {
  const { t } = useTranslation();
  const { label, fg, bg } = jobBadge(job);

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
      <Text style={{ fontFamily: 'Roboto_700Bold', fontSize: 11, color: fg }}>{t(`jobs.status.${label}`)}</Text>
    </View>
  );
}
