import { t } from 'i18next';

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

type Slotted = Pick<Job, 'slotStart' | 'slotEnd'>;

/**
 * "Today · 2:00 PM–4:00 PM" — in IST, the zone the slot was agreed in.
 *
 * With no agreed time it says so (`jobs.slot.notSet`): not "—" and not blank.
 * The technician is deciding whether to take this, and the honest fact is that
 * a time is coming but has not been chosen yet — an em-dash reads as missing
 * data, which is a reason to distrust the card rather than to accept it.
 *
 * NOT approved copy, that sentence: the prototype has no slotless job. See the
 * note at the head of the pool screen.
 */
export function jobSlot(job: Slotted): string {
  return job.slotStart && job.slotEnd
    ? slotLabel(job.slotStart, job.slotEnd)
    : t('jobs.slot.notSet');
}

/** "2–4 PM", for dense rows. */
export function jobSlotShort(job: Slotted): string {
  return job.slotStart && job.slotEnd
    ? hourRangeLabel(job.slotStart, job.slotEnd)
    : t('jobs.slot.notSetShort');
}

/** "24h" — the service level as a value. */
export function jobSla(job: Pick<Job, 'slaHours'>): string {
  return t('jobs.sla.value', { hours: job.slaHours });
}

/** "SLA 24h" — the service level as a card's pill. */
export function jobSlaPill(job: Pick<Job, 'slaHours'>): string {
  return t('jobs.sla.pill', { hours: job.slaHours });
}
