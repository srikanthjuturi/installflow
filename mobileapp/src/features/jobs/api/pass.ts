import { ApiError, authedRequest } from '@/lib/api';

/**
 * `POST /jobs/:id/pass` — this technician says no to one offer.
 *
 * The server records it, and the job stops appearing in THIS technician's
 * pool; everybody else is still offered it. It comes back by itself if its
 * time or bonus changes, because that is a different offer.
 *
 * Idempotent on the server: passing twice, or passing a job somebody accepted
 * a second ago, is still a success.
 *
 * A 404 is also treated as done. It means the job is no longer offerable to
 * this technician at all — its time began, or it was withdrawn — so it is off
 * their list either way, which is all a pass asks for. Showing "couldn't pass"
 * over a job that has already gone would send them to retry something that
 * cannot fail again.
 */
export async function passJob(id: string): Promise<void> {
  try {
    await authedRequest<null>(`/jobs/${id}/pass`, { method: 'POST' });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return;
    throw error;
  }
}
