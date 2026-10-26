import { color } from '@/theme/semantic';
import type { Job } from '@/types/domain';

export type BadgeJob = Pick<Job, 'status' | 'slotStart' | 'slotEnd'> &
  Partial<Pick<Job, 'serverStatus'>>;

export const STARTING_SOON_MS = 4 * 3_600_000;

/**
 * Resolves a job's badge itself rather than taking a label + colour, so the
 * "Starting soon" rule (≤4h to the committed slot) lives in exactly one place —
 * here, which Home's and My jobs' cards call too. That threshold is the same
 * one a cancellation escalates on — under it the job goes straight to the Area
 * Service Manager. The penalty AMOUNT is a company rule and is never assumed
 * here; the server sends it.
 *
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
  // Before the generic in-progress line, which would otherwise win: the part
  // has to land first (Task 12), and "In progress" would read as something the
  // technician could be doing about it.
  if (job.serverStatus === 'Awaiting Part')
    return { label: 'awaitingPart', ...color.statusAwaitingPart } as const;
  if (job.status === 'inprogress') return { label: 'inProgress', ...color.statusInProgress } as const;
  if (!job.slotStart) return { label: 'awaitingTime', ...color.statusUpcoming } as const;
  const start = Date.parse(job.slotStart);
  const end = job.slotEnd ? Date.parse(job.slotEnd) : start;
  if (end <= now) return { label: 'slotClosed', ...color.statusSlotClosed } as const;
  if (start - now <= STARTING_SOON_MS) return { label: 'startingSoon', ...color.statusStartingSoon } as const;
  return { label: 'upcoming', ...color.statusUpcoming } as const;
}