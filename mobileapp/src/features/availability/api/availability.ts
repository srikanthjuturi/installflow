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
}

export function setAcceptingWork(acceptingWork: boolean): Promise<AvailabilityResult> {
  return authedRequest<AvailabilityResult>('/technicians/me/availability', {
    method: 'PATCH',
    body: { acceptingWork },
  });
}
