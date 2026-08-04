import { jobs } from '@/mocks/db';
import { delay } from '@/mocks/delay';
import type { Job } from '@/types/domain';

/**
 * Losing the race is a normal outcome, not a failure — assignment is
 * first-accept-wins (doc §6). Typed so the UI can tell "someone beat me to it"
 * apart from a genuine error; at binding time this maps to HTTP 409.
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
 * Jobs another technician already claimed. Deterministic rather than random so
 * the "job taken" screen is demonstrable on demand without a coin flip
 * derailing a live demo.
 */
const CLAIMED_BY_OTHERS = new Set(['INST-4861']);

/**
 * UI phase: mutates the in-memory dataset.
 * Binding phase: `POST /jobs/:id/accept` — 200 returns the unlocked job, 409
 * means it's gone. Nothing above this function changes.
 */
export async function acceptJob(id: string): Promise<Job> {
  await delay(`accept:${id}`, 400, 800);

  const job = jobs.find((j) => j.id === id);
  if (!job) throw new Error(`Job ${id} not found`);

  if (CLAIMED_BY_OTHERS.has(id) || job.status !== 'pool') {
    throw new JobTakenError(id);
  }

  job.status = 'upcoming';
  return job;
}
