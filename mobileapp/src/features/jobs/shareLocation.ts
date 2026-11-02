import { ApiError } from '@/lib/api';

/**
 * Epic 4 — the pure decisions behind `useShareLocation`.
 *
 * Kept free of expo-location, React and the network so every rule can be
 * tested without a device: when the watcher runs, how often a fix is sent, and
 * what each failure means.
 */

/** The statuses in which the company may see where the technician is. */
export const SHARING_STATUSES: readonly string[] = ['Assigned', 'In Progress', 'Awaiting Part'];

/** Used until the first acknowledgement names the server's own figure. */
export const DEFAULT_MIN_GAP_SECONDS = 20;

export type LocationPermission = 'granted' | 'denied' | 'unknown';

export interface WatchInputs {
  /** The server's status word for the job; undefined while it loads. */
  status: string | undefined;
  /** AppState === 'active'. */
  appActive: boolean;
  signedIn: boolean;
  permission: LocationPermission;
  /** The server said stop (409 JOB_NOT_ACTIVE / 404) for this job. */
  stoppedByServer: boolean;
}

export function isSharingStatus(status: string | undefined | null): boolean {
  return !!status && SHARING_STATUSES.includes(status);
}

/** Everything but permission: whether it is worth asking for permission at all. */
export function wantsToShare(i: Omit<WatchInputs, 'permission'>): boolean {
  return i.appActive && i.signedIn && !i.stoppedByServer && isSharingStatus(i.status);
}

/** Whether a position watcher should be running right now. */
export function shouldWatch(i: WatchInputs): boolean {
  return wantsToShare(i) && i.permission === 'granted';
}

/** Whether the "company can't see where you are" note is due. */
export function showDeniedNote(i: WatchInputs): boolean {
  return wantsToShare(i) && i.permission === 'denied';
}

/**
 * Whether a fix taken at `now` may be sent. `nextAfterSeconds` is the server's
 * own figure from the last acknowledgement; nothing sent yet → send.
 */
export function shouldSend(
  now: number,
  lastSentAt: number | null,
  nextAfterSeconds: number = DEFAULT_MIN_GAP_SECONDS,
): boolean {
  if (lastSentAt === null) return true;
  const gap =
    Number.isFinite(nextAfterSeconds) && nextAfterSeconds > 0
      ? nextAfterSeconds
      : DEFAULT_MIN_GAP_SECONDS;
  return now - lastSentAt >= gap * 1000;
}

export type FailureAction =
  /** The job is not (or no longer) this technician's to report on: stop for the session. */
  | 'stop'
  /** Anything else: lose this one report; the next fix replaces it. */
  | 'drop';

export function classifyFailure(error: unknown): FailureAction {
  if (error instanceof ApiError) {
    if (error.status === 404) return 'stop';
    if (error.status === 409 && error.code === 'JOB_NOT_ACTIVE') return 'stop';
  }
  return 'drop';
}
