import { jobBadge } from '@/components/ui/jobBadge';
import type { Job } from '@/types/domain';

/** True when the job's current badge is "Slot closed" (window ended, still Upcoming). */
export function isSlotClosed(job: Job, now: number = Date.now()): boolean {
  return jobBadge(job, now).label === 'slotClosed';
}

/** How many jobs in a list are currently slot-closed. */
export function slotClosedCount(jobs: Job[], now: number = Date.now()): number {
  return jobs.filter((j) => isSlotClosed(j, now)).length;
}

/**
 * Trim, case-insensitive substring over ticket code, customer name and pincode;
 * a blank query returns the list unchanged. Same shape as parts' filterParts.
 */
export function searchJobs(jobs: Job[], query: string): Job[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return jobs;
  return jobs.filter((j) => {
    const code = (j.code ?? j.id).toLowerCase();
    const customer = (j.customer ?? j.maskedCustomer ?? '').toLowerCase();
    const pincode = (j.pincode ?? '').toLowerCase();
    return code.includes(needle) || customer.includes(needle) || pincode.includes(needle);
  });
}
