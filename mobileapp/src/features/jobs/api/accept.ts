import { toAcceptedJob, type JobDto } from '@/features/jobs/api/jobs';
import { ApiError, authedRequest } from '@/lib/api';
import type { Job } from '@/types/domain';

/**
 * Losing the race is a normal outcome, not a failure — assignment is
 * first-accept-wins (doc §6). Typed so the UI can tell "someone beat me to it"
 * apart from a genuine error; on the wire that difference is HTTP 409.
 */
export class JobTakenError extends Error {
  readonly code = 'JOB_ALREADY_TAKEN';

  constructor(jobId: string) {
    super(`Job ${jobId} was accepted by another technician`);
    this.name = 'JobTakenError';
  }
}

export function isJobTaken(error: unknown): error is JobTakenError {
  return error instanceof JobTakenError;
}

/**
 * A refusal that is not "somebody beat you to it".
 *
 * Three of them, and the first two are the technician's own settings, fixed on
 * the Availability screen: the day is full, or availability is switched off.
 *
 * The third is nobody's fault. `JOB_ESCALATED` means the slot came close with
 * this job still unclaimed, so it left the pool and went to the Area Service
 * Manager — the card is simply stale. Reporting that as "another technician
 * accepted this job first" would be false, and it would send them back to a
 * pool looking for the next one when the honest answer is that this job is now
 * somebody else's to hand out.
 *
 * All three must be told apart from `JobTakenError`, the one message that
 * sends somebody back to a pool with nothing in it for them.
 */
export class JobRefusedError extends Error {
  constructor(
    readonly code: 'DAILY_CAP_REACHED' | 'NOT_ACCEPTING_WORK' | 'JOB_ESCALATED',
    message: string,
  ) {
    super(message);
    this.name = 'JobRefusedError';
  }
}

export function isJobRefused(error: unknown): error is JobRefusedError {
  return error instanceof JobRefusedError;
}

/**
 * `POST /jobs/:id/accept` — 200 returns the unlocked job, 409 means no.
 *
 * Four different noes share that status, so this switches on the envelope's
 * `code`, not on the status. It used to map EVERY 409 to `JobTakenError`, which
 * was correct while losing the race was the only way to be refused; once the
 * daily cap landed it became a lie, and the server's own message — the one
 * naming the day and the limit — was thrown away before anybody could read it.
 *
 * An unrecognised code still falls back to "taken": a server that grows a
 * fifth reason should degrade to the old behaviour rather than to a crash.
 */
const REFUSAL_CODES = [
  'DAILY_CAP_REACHED',
  'NOT_ACCEPTING_WORK',
  'JOB_ESCALATED',
] as const;

export async function acceptJob(id: string): Promise<Job> {
  try {
    return toAcceptedJob(await authedRequest<JobDto>(`/jobs/${id}/accept`, { method: 'POST' }));
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      const refusal = REFUSAL_CODES.find((code) => code === error.code);
      if (refusal) throw new JobRefusedError(refusal, error.message);
      throw new JobTakenError(id);
    }
    throw error;
  }
}
