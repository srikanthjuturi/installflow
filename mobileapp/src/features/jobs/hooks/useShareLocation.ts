import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { reportLocation } from '@/features/jobs/api/location';
import {
  DEFAULT_MIN_GAP_SECONDS,
  classifyFailure,
  shouldSend,
  shouldWatch,
  wantsToShare,
  type LocationPermission,
} from '@/features/jobs/shareLocation';
import { useSession } from '@/store/session.store';
import type { Job } from '@/types/domain';

export type ShareState = 'idle' | 'sharing' | 'denied';

/** Asked once per app session; after a denial we never ask again, only point at Settings. */
let askedThisSession = false;
/** Only one watcher at a time, wherever the hook is mounted. */
let owner: symbol | null = null;
/** Jobs the server told us to stop reporting on, for this session. */
const stoppedJobs = new Set<string>();

/**
 * Epic 4 — shares the technician's position with the company while the job is
 * active, FOREGROUND ONLY: the watcher lives only while the screen is mounted
 * and the app is in front. Never blocks anything; failures are silent.
 */
export function useShareLocation(job: Pick<Job, 'id' | 'serverStatus'> | undefined): ShareState {
  const jobId = job?.id;
  const status = job?.serverStatus;
  const signedIn = useSession((s) => !!s.accessToken);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [permission, setPermission] = useState<LocationPermission>('unknown');
  const [stopped, setStopped] = useState(false);
  const [watching, setWatching] = useState(false);
  const me = useRef(Symbol('share-location')).current;

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  // A new job starts afresh, unless the server already told us to stop for it.
  useEffect(() => {
    setStopped(!!jobId && stoppedJobs.has(jobId));
  }, [jobId]);

  const base = { status, appActive, signedIn, stoppedByServer: stopped };
  const wants = wantsToShare(base);

  // Permission: read it, ask at most once per session, never nag after a denial.
  useEffect(() => {
    if (!wants) return;
    let cancelled = false;
    (async () => {
      try {
        let current = await Location.getForegroundPermissionsAsync();
        if (!current.granted && current.canAskAgain && !askedThisSession) {
          askedThisSession = true;
          current = await Location.requestForegroundPermissionsAsync();
        }
        if (!cancelled) setPermission(current.granted ? 'granted' : 'denied');
      } catch {
        if (!cancelled) setPermission('denied');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wants]);

  const run = shouldWatch({ ...base, permission });

  useEffect(() => {
    if (!run || !jobId) return;
    if (owner !== null && owner !== me) return;
    owner = me;

    let live = true;
    let lastSentAt: number | null = null;
    let gapSeconds = DEFAULT_MIN_GAP_SECONDS;
    let inFlight = false;
    let subscription: Location.LocationSubscription | null = null;

    const stop = () => {
      live = false;
      subscription?.remove();
      subscription = null;
      if (owner === me) owner = null;
      setWatching(false);
    };

    (async () => {
      try {
        const sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 20_000,
            distanceInterval: 25,
          },
          (position) => {
            const now = Date.now();
            if (!live || inFlight || !shouldSend(now, lastSentAt, gapSeconds)) return;
            inFlight = true;
            lastSentAt = now;
            reportLocation(jobId, {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracyM: position.coords.accuracy ?? undefined,
              recordedAt: new Date(position.timestamp).toISOString(),
            })
              .then((ack) => {
                if (ack && ack.nextAfterSeconds > 0) gapSeconds = ack.nextAfterSeconds;
              })
              .catch((error) => {
                if (classifyFailure(error) === 'stop') {
                  stoppedJobs.add(jobId);
                  if (live) {
                    stop();
                    setStopped(true);
                  }
                }
              })
              .finally(() => {
                inFlight = false;
              });
          },
        );
        if (live) {
          subscription = sub;
          setWatching(true);
        } else {
          sub.remove();
        }
      } catch {
        if (live) stop();
      }
    })();

    return stop;
  }, [run, jobId, me]);

  if (watching && run) return 'sharing';
  if (wants && permission === 'denied') return 'denied';
  return 'idle';
}
