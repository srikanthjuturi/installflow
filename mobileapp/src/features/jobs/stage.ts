import type { Job, JobStatus } from '@/types/domain';

const STATUS_MAP: Readonly<Record<string, JobStatus>> = {
  New: 'pool',
  'Slot Pending': 'pool',
  Assigned: 'upcoming',
  'In Progress': 'inprogress',
  'Awaiting Customer': 'inprogress',
  'Awaiting Part': 'inprogress',
  'AI Review': 'inprogress',
  Escalated: 'inprogress',
  Closed: 'completed',
  'Force-Closed': 'completed',
  Cancelled: 'cancelled',
};

/** Total. Unknown → `inprogress`: still being worked, and no screen offers an action on it. */
export function toJobStatus(status: unknown): JobStatus {
  return typeof status === 'string' && Object.prototype.hasOwnProperty.call(STATUS_MAP, status)
    ? (STATUS_MAP[status] as JobStatus)
    : 'inprogress';
}

export type JobStage =
  | 'start' | 'awaitingTime' | 'complete' | 'awaitingCustomer' | 'awaitingPart'
  | 'escalated' | 'done' | 'none' | 'unknown';

export interface JobActions { stage: JobStage; canCancel: boolean; canReschedule: boolean }

/**
 * What Job detail offers, from the server's own word. The one place that
 * decides it.
 *
 * Unknown → `unknown`, not a Start button: `upcoming` was what put one on a
 * status newer than this build, and the only thing a Start on a stage the app
 * cannot name ends in is a server refusal. Which tab a job sits in is the
 * server's `SEGMENTS`, not this mapping.
 */
export function jobActions(job: Pick<Job, 'serverStatus' | 'hoursToSlot'>): JobActions {
  const nothing = { canCancel: false, canReschedule: false };
  switch (job.serverStatus) {
    case 'Assigned':
      return job.hoursToSlot === null
        ? { stage: 'awaitingTime', canCancel: true, canReschedule: false }
        : { stage: 'start', canCancel: true, canReschedule: true };
    case 'In Progress':       return { stage: 'complete', ...nothing };
    case 'Awaiting Customer': return { stage: 'awaitingCustomer', ...nothing };
    case 'Awaiting Part':     return { stage: 'awaitingPart', ...nothing };
    case 'Escalated':
    case 'AI Review':         return { stage: 'escalated', ...nothing };
    case 'Closed':
    case 'Force-Closed':
    case 'Cancelled':         return { stage: 'done', ...nothing };
    case 'New':
    case 'Slot Pending':
    case undefined:           return { stage: 'none', ...nothing };
    default:                  return { stage: 'unknown', ...nothing };
  }
}