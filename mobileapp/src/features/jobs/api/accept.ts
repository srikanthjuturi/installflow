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
 * `POST /jobs/:id/accept` — 200 returns the unlocked job, 409 means it is gone.
 *
 * The server settles the race in the WHERE clause of a single UPDATE, so a 409
 * here is authoritative: somebody else's row went in first. Nothing above this
 * function changed when it stopped being mock.
 */
export async function acceptJob(id: string): Promise<Job> {
  try {
    return toAcceptedJob(await authedRequest<JobDto>(`/jobs/${id}/accept`, { method: 'POST' }));
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) throw new JobTakenError(id);
    throw error;
  }
}
