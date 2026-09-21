import type { Job } from '@/types/domain';
import { hourRangeLabel, slotLabel } from '@/utils/date';

/**
 * A job's slot and service level, in words — made while rendering.
 *
 * The job itself only holds the instants (`slotStart`/`slotEnd`) and the
 * hours. It used to hold these labels too, built in the API mapper, which put
 * English into the query cache: a technician who switched language would have
 * kept reading "Today" on every card until the next refetch.
 */

/**
 * What a job with no agreed time says where a slot would go.
 *
 * Not "—" and not blank. The technician is deciding whether to take this, and
 * the honest fact is that a time is coming but has not been chosen yet — an
 * em-dash reads as missing data, which is a reason to distrust the card rather
 * than a reason to accept it.
 *
 * NOT approved copy: the prototype has no slotless job, so there is no approved
 * string for this state. See the note at the head of the pool screen.
 */
export const NO_SLOT_YET = 'Time not set yet';
export const NO_SLOT_SHORT = 'No time yet';

type Slotted = Pick<Job, 'slotStart' | 'slotEnd'>;

/** "Today · 2:00 PM–4:00 PM" — in IST, the zone the slot was agreed in. */
export function jobSlot(job: Slotted): string {
  return job.slotStart && job.slotEnd ? slotLabel(job.slotStart, job.slotEnd) : NO_SLOT_YET;
}

/** "2–4 PM", for dense rows. */
export function jobSlotShort(job: Slotted): string {
  return job.slotStart && job.slotEnd
    ? hourRangeLabel(job.slotStart, job.slotEnd)
    : NO_SLOT_SHORT;
}

/** "24h" — the service level as a card prints it. */
export function jobSla(job: Pick<Job, 'slaHours'>): string {
  return `${job.slaHours}h`;
}
