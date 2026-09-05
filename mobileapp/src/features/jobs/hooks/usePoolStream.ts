import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { API_BASE_URL, refreshAccessToken } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { useAcceptingWork } from '@/features/availability/hooks/useAvailability';
import { useRealtimeStore } from '@/store/realtime.store';
import { getAccessToken, useSession } from '@/store/session.store';

/**
 * The live pool: one websocket for the whole signed-in session.
 *
 * Mounted once, in `app/(app)/_layout.tsx`. Not in a screen — Home and the Pool
 * tab both read the same query key, so a socket per screen would open two
 * connections to deliver the same news, and would drop the stream every time
 * the technician switched tabs.
 *
 * ## What arrives
 *
 * Two frames, and neither carries any job data (see `app/core/realtime.py`):
 *
 *   `pool.changed`  something you might be able to take has changed. Broadcast
 *                   to everyone whose coverage matches.
 *   `job.changed`   one of YOUR jobs moved, with its id. Addressed — the server
 *                   sends it to one technician.
 *
 * Both are answered the same way: invalidate and let the normal authenticated
 * fetch bring it back — masked, tenant-scoped, exactly as it always was. This
 * hook adds a transport, not a second source of truth.
 *
 * ## The availability toggle gates the OFFERS, not the socket
 *
 * The two frames answer to different rules, and conflating them was a bug. An
 * offline technician must receive no offers — so `pool.changed` is dropped —
 * but `job.changed` is the customer answering for work they have already done,
 * and there is no version of "I have finished for the day" that means "do not
 * tell me the customer said it was not done".
 *
 * So the connection follows the SESSION and the toggle is read per frame. The
 * server never consulted the toggle anyway (`api/app/features/jobs/ws.py`
 * authenticates and nothing more), so this is entirely a client rule.
 *
 * The cost is a socket held while an offline technician has the app open, and
 * presence stamped for them — which is the honest reading of `last_seen_at`:
 * their phone IS answering. The console's pill takes "accepting work" and
 * "reachable" as two facts precisely because they are two facts.
 *
 * ## Why the poll survives
 *
 * `usePool` keeps a timer even while this is connected, just a much slower one.
 * A socket that has silently died looks exactly like a quiet pool, and a
 * technician cannot be left staring at a stale screen because a NAT table
 * somewhere forgot about them. The stream makes the app fast; the poll is what
 * makes it *correct*, and the two costs are not the same.
 */

/** `https://host/api/v1` → `wss://host/api/v1/jobs/stream`. */
function streamUrl(): string {
  return `${API_BASE_URL.replace(/^http/, 'ws')}/jobs/stream`;
}

/** The server's spelling of a 401 — the access token expired mid-session. */
const CLOSE_AUTH_FAILED = 4401;

/**
 * Reconnect backoff. Doubles to a cap, and every delay is jittered.
 *
 * The jitter is not decoration. When the API restarts, every connected phone is
 * disconnected in the same instant; without it they would all reconnect in the
 * same instant too, and keep doing so in lockstep on every retry — a thundering
 * herd the deploy itself created.
 */
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

function nextDelay(previous: number): number {
  const grown = Math.min(previous * 2, BACKOFF_MAX_MS);
  return grown / 2 + Math.random() * (grown / 2);
}

export function usePoolStream(): void {
  const queryClient = useQueryClient();
  const online = useAcceptingWork();
  const hasSession = useSession((s) => !!s.accessToken);
  const setStreamConnected = useRealtimeStore((s) => s.setStreamConnected);

  // Everything the reconnect loop mutates lives in refs: putting the socket or
  // the current delay in state would re-run this effect on every reconnect,
  // which is itself a reconnect.
  const socketRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delayRef = useRef(BACKOFF_MIN_MS);
  const closedByUsRef = useRef(false);

  // The toggle is read INSIDE the message handler, not from the effect's
  // dependency list. It decides what to do with a frame; it must not tear the
  // connection down and build it again every time somebody flips it.
  const onlineRef = useRef(online);
  useEffect(() => {
    onlineRef.current = online;
  }, [online]);

  useEffect(() => {
    // Signed in is the whole condition. The toggle used to be part of it, which
    // silently cost the technician their OWN job updates: `job.changed` is the
    // customer answering — confirming the work, or saying it was not done — and
    // somebody who has stopped taking new offers has not stopped caring about
    // the job they finished an hour ago.
    //
    // "Not receiving offers" stays literally true: `pool.changed` is dropped
    // below while the toggle is off, so no offer ever reaches the screen.
    if (!hasSession) return;

    closedByUsRef.current = false;

    const clearTimer = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (closedByUsRef.current) return;
      clearTimer();
      delayRef.current = nextDelay(delayRef.current);
      timerRef.current = setTimeout(connect, delayRef.current);
    };

    function connect() {
      if (closedByUsRef.current) return;

      const token = getAccessToken();
      if (!token) return;

      let socket: WebSocket;
      try {
        socket = new WebSocket(streamUrl());
      } catch {
        // A malformed URL or an exhausted socket table. Treat it as a drop.
        scheduleReconnect();
        return;
      }
      socketRef.current = socket;

      socket.onopen = () => {
        // The token goes in the first frame, never in the URL — a query string
        // is written to every access log and proxy between here and Azure, and
        // an access token is a bearer credential.
        socket.send(JSON.stringify({ type: 'auth', token }));
      };

      socket.onmessage = (event) => {
        let frame: { type?: string };
        try {
          frame = JSON.parse(String(event.data)) as { type?: string };
        } catch {
          return;
        }

        switch (frame.type) {
          case 'ready':
            setStreamConnected(true);
            delayRef.current = BACKOFF_MIN_MS;
            // Whatever happened while this device was disconnected was missed
            // outright — the server keeps no backlog. So a fresh connection
            // always re-reads once, which is what makes a reconnect after a
            // tunnel or a signal drop leave a correct screen behind.
            //
            // The whole `jobs` prefix, not just the pool. Only the pool was
            // re-read here, so a `job.changed` that arrived while the phone was
            // in a tunnel was simply lost — and that frame is the customer
            // answering, which is the one thing on this socket nobody else will
            // tell them about.
            //
            // The prefix rather than a list of keys: a reconnect cannot know
            // WHICH job moved, and enumerating them is how the next key added
            // to `qk` quietly stops being restored. Invalidation only refetches
            // queries that are actually mounted, so the breadth costs a request
            // for the screen in front of the technician and nothing else.
            void queryClient.invalidateQueries({ queryKey: ['jobs'] });
            // The money too, for the same reason. A closure that landed while
            // this phone was in a tunnel — or, far more often, backgrounded,
            // since the socket is torn down there — paid the technician, and
            // earnings opt out of refetch-on-focus. Without this the reconnect
            // left a correct job list beside a figure from before the payout.
            void queryClient.invalidateQueries({ queryKey: qk.earnings() });
            break;
          case 'pool.changed':
            // Dropped while offline. This is where "Not receiving offers"
            // is kept honest now that the socket itself stays open.
            if (onlineRef.current) {
              void queryClient.invalidateQueries({ queryKey: qk.pool() });
            }
            break;
          case 'job.changed': {
            // One of THIS technician's own jobs moved — almost always the
            // customer answering the confirmation link. They may still be
            // outside the house, and if the answer was "not done" that is
            // exactly when they need to know.
            const jobId = (frame as { jobId?: string }).jobId;
            if (jobId) void queryClient.invalidateQueries({ queryKey: qk.job(jobId) });
            void queryClient.invalidateQueries({ queryKey: ['jobs', 'mine'] });
            void queryClient.invalidateQueries({
              queryKey: [...qk.myJobs('all'), 'today'],
            });
            // A closure MOVES MONEY, and this frame is the only warning of it
            // the app gets. Both closers write the payout in the same
            // transaction as the transition — the customer confirming, and a
            // manager force-closing for the amount they credited — so the
            // ledger has changed by the time this arrives. The push landed
            // instantly and the figure did not, because nothing invalidated
            // earnings outside `useCancelJob`.
            //
            // The PREFIX, for `qk.earnings()`'s own reason: a payout lands in
            // the day AND the week AND whatever span the technician is looking
            // at, so naming one window leaves the others showing the old total.
            void queryClient.invalidateQueries({ queryKey: qk.earnings() });
            // And the profile, which the same closure just rewrote: the server
            // recomputes the rating and the completed count on the way out
            // (`refresh_technician_stats`), so leaving `me` alone would show a
            // technician a job they finished missing from their own total.
            void queryClient.invalidateQueries({ queryKey: qk.me() });
            break;
          }
          // 'ping' needs no reply. It exists so a dead connection fails
          // instead of looking idle; receiving it is already proof of life.
        }
      };

      socket.onerror = () => {
        // React Native delivers an error and then a close for the same failure.
        // Reconnecting is `onclose`'s job, so this only stops the UI claiming
        // a connection that is on its way down.
        setStreamConnected(false);
      };

      socket.onclose = (event) => {
        setStreamConnected(false);
        socketRef.current = null;
        if (closedByUsRef.current) return;

        if (event.code === CLOSE_AUTH_FAILED) {
          // Same recovery as an HTTP 401, and the same reason it must be
          // shared: the refresh token rotates, so two racing refreshes would
          // sign a working technician out. `refreshAccessToken` dedupes.
          void refreshAccessToken().then((fresh) => {
            if (fresh) {
              delayRef.current = BACKOFF_MIN_MS;
              connect();
            }
            // A failed refresh means the session is genuinely over. The HTTP
            // path signs out and the `(app)` guard redirects; this hook does
            // not need to duplicate that, and must not race it.
          });
          return;
        }

        scheduleReconnect();
      };
    }

    const teardown = () => {
      closedByUsRef.current = true;
      clearTimer();
      setStreamConnected(false);
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        // Drop the handlers first: closing fires `onclose`, which would
        // otherwise queue a reconnect for a socket we are deliberately ending.
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        socket.close();
      }
    };

    // A backgrounded app must not hold a socket open. iOS suspends the process
    // and the connection dies unnoticed; Android keeps it and spends battery on
    // a list nobody is reading. Both are answered by closing on background and
    // opening again on return — and the `ready` frame's refetch means coming
    // back is also what re-reads the pool.
    const onAppState = (state: AppStateStatus) => {
      if (state === 'background') {
        teardown();
      } else if (socketRef.current === null && timerRef.current === null) {
        closedByUsRef.current = false;
        delayRef.current = BACKOFF_MIN_MS;
        connect();
      }
    };

    const subscription = AppState.addEventListener('change', onAppState);
    connect();

    return () => {
      subscription.remove();
      teardown();
    };
  }, [hasSession, queryClient, setStreamConnected]);
}
