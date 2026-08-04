import { jobs } from '@/mocks/db';
import { delay } from '@/mocks/delay';
import type { Job, JobStatus } from '@/types/domain';

/**
 * Job reads for the UI phase.
 *
 * Each function is a seam: swap the body for the matching request and neither
 * the hooks nor the screens change.
 *   listPool   → GET /jobs/pool
 *   getOffer   → GET /jobs/pool/:id      (masked)
 *   listMine   → GET /jobs/mine?status=
 *   getJob     → GET /jobs/:id           (unlocked)
 */

/** Strips fields the API must not send before the technician accepts (doc §6). */
function mask(job: Job): Job {
  const { customer, address, phone, ...rest } = job;
  void customer;
  void address;
  void phone;
  return rest;
}

export async function listPool(): Promise<Job[]> {
  await delay('jobs:pool');
  return jobs.filter((j) => j.status === 'pool' && j.hoursToSlot >= 0).map(mask);
}

export async function getOffer(id: string): Promise<Job> {
  await delay(`jobs:pool:${id}`);
  const job = jobs.find((j) => j.id === id);
  if (!job) throw new Error(`Job ${id} not found`);
  return mask(job);
}

export async function listMine(status: JobStatus | 'all'): Promise<Job[]> {
  await delay(`jobs:mine:${status}`);
  const mine = jobs.filter((j) => j.status !== 'pool');
  return status === 'all' ? mine : mine.filter((j) => j.status === status);
}

export async function getJob(id: string): Promise<Job> {
  await delay(`jobs:${id}`);
  const job = jobs.find((j) => j.id === id);
  if (!job) throw new Error(`Job ${id} not found`);
  // Full detail is only legitimate once the job belongs to this technician.
  return job.status === 'pool' ? mask(job) : job;
}

/** Jobs committed for today — drives the Home list. */
export async function listToday(): Promise<Job[]> {
  await delay('jobs:today');
  return jobs.filter(
    (j) =>
      (j.status === 'upcoming' || j.status === 'inprogress') &&
      j.hoursToSlot >= 0 &&
      j.hoursToSlot < 12,
  );
}
