import { authedRequest } from '@/lib/api';

/** What the server says after the toggle moves. */
export interface AvailabilityResult {
  /** The technician's own decision, as now stored. */
  acceptingWork: boolean;
  /**
   * Intent AND reachability — the server's derived answer.
   *
   * Returned rather than computed here on purpose: reachability is a time
   * window measured from the live socket's last ping, and that window lives in
   * one place on the server (`app/core/presence.py`). A copy of the rule in the
   * app would drift the first time somebody tuned it.
   */
  online: boolean;
  /** The daily job cap as now stored. **Null means no limit.** */
  dailyJobCap: number | null;
  /**
   * Jobs already held for today, counted by the same rule the cap is enforced
   * with. Deliberately not derived from `/jobs/today`, which excludes closed
   * jobs and would show a smaller number than the server actually enforces —
   * the screen would read "2 of 5" while an accept was being refused.
   */
  jobsToday: number;
}

export function setAcceptingWork(acceptingWork: boolean): Promise<AvailabilityResult> {
  return authedRequest<AvailabilityResult>('/technicians/me/availability', {
    method: 'PATCH',
    body: { acceptingWork },
  });
}

/**
 * Set or clear the daily cap. `null` means NO LIMIT and is a real value, not an
 * omission — the server distinguishes the two, so this always sends the key.
 */
export function setDailyJobCap(dailyJobCap: number | null): Promise<AvailabilityResult> {
  return authedRequest<AvailabilityResult>('/technicians/me/availability', {
    method: 'PATCH',
    body: { dailyJobCap },
  });
}
