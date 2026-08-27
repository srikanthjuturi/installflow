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
 * A refusal the technician can act on, but not by trying another job.
 *
 * Two of them: the day is full, or availability is switched off. Both are the
 * technician's own settings and both are fixed on the Availability screen —
 * which is why they must not be reported as "somebody beat you to it", the
 * one message that sends them back to a pool with nothing in it for them.
 */
export class JobRefusedError extends Error {
  constructor(
    readonly code: 'DAILY_CAP_REACHED' | 'NOT_ACCEPTING_WORK',
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
 * Three different noes share that status, so this switches on the envelope's
 * `code`, not on the status. It used to map EVERY 409 to `JobTakenError`, which
 * was correct while losing the race was the only way to be refused; once the
 * daily cap landed it became a lie, and the server's own message — the one
 * naming the day and the limit — was thrown away before anybody could read it.
 *
 * An unrecognised code still falls back to "taken": a server that grows a
 * fourth reason should degrade to the old behaviour rather than to a crash.
 */
export async function acceptJob(id: string): Promise<Job> {
  try {
    return toAcceptedJob(await authedRequest<JobDto>(`/jobs/${id}/accept`, { method: 'POST' }));
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      if (error.code === 'DAILY_CAP_REACHED' || error.code === 'NOT_ACCEPTING_WORK') {
        throw new JobRefusedError(error.code, error.message);
      }
      throw new JobTakenError(id);
    }
    throw error;
  }
}
