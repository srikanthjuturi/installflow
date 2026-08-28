import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { BASE_URL } from "@/services/http";
import { useSession } from "@/store/session";
import { dashboardKeys } from "./useDashboard";
import { notificationKeys } from "./useNotifications";
import { technicianKeys } from "./useTechnicians";
import { ticketKeys } from "./useTickets";

/**
 * Live ticket movement — and the bell — for the console and the vendor portal.
 *
 * One socket for the whole signed-in session, mounted once high in the tree.
 * The server sends `{"type":"ticket.changed","ticketId":…}` and nothing else —
 * no status, no customer — so the only thing to do with it is invalidate and
 * let the normal authenticated read bring the row back, scoped by territory or
 * by vendor ownership exactly as it always was.
 *
 * Which tickets reach this socket is decided server-side against the same rule
 * as `GET /tickets`. A vendor is never told that another vendor's ticket
 * changed, because being told an id exists is itself the leak.
 */

/** `https://host/api/v1` → `wss://host/api/v1/tickets/stream`. */
function streamUrl(): string {
  return `${BASE_URL.replace(/^http/, "ws")}/tickets/stream`;
}

/**
 * Anything else that wants to know a frame arrived.
 *
 * The socket stays the one owner of the connection and of what each frame
 * invalidates; this is only a way for a second consumer to hear about one
 * without opening a second socket. `useNotificationToasts` is the first.
 *
 * Module-level rather than a callback prop because the socket is mounted in the
 * shell and the listener is mounted beside it — threading a handler through
 * would make every shell responsible for wiring something neither of them owns.
 */
type StreamListener = () => void;
const listeners = new Map<string, Set<StreamListener>>();

/** Listen for one frame type. Returns the unsubscribe. */
export function onStreamEvent(type: string, listener: StreamListener): () => void {
  const set = listeners.get(type) ?? new Set();
  set.add(listener);
  listeners.set(type, set);
  return () => set.delete(listener);
}

function emit(type: string): void {
  for (const listener of listeners.get(type) ?? []) {
    try {
      listener();
    } catch {
      // One bad listener must not stop the others, and must never take down
      // the socket's message handler — the invalidations above are the part
      // that has to keep working.
    }
  }
}

/** The server's spelling of a 401 — the access token expired. */
const CLOSE_AUTH_FAILED = 4401;

const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

/**
 * Jittered, for the reason every reconnect should be: an API restart
 * disconnects every open console at the same instant, and without jitter they
 * would all come back at the same instant too, and keep doing so in lockstep.
 */
function nextDelay(previous: number): number {
  const grown = Math.min(previous * 2, BACKOFF_MAX_MS);
  return grown / 2 + Math.random() * (grown / 2);
}

export function useTicketStream(): void {
  const queryClient = useQueryClient();
  const token = useSession((s) => s.accessToken);

  const socketRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delayRef = useRef(BACKOFF_MIN_MS);
  const closedByUsRef = useRef(false);

  useEffect(() => {
    if (!token) return;
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

      let socket: WebSocket;
      try {
        socket = new WebSocket(streamUrl());
      } catch {
        scheduleReconnect();
        return;
      }
      socketRef.current = socket;

      socket.onopen = () => {
        // First frame, never the query string — a URL is written to every
        // access log and proxy between here and the API, and an access token is
        // a bearer credential.
        socket.send(JSON.stringify({ type: "auth", token }));
      };

      socket.onmessage = (event) => {
        let frame: { type?: string; ticketId?: string };
        try {
          frame = JSON.parse(String(event.data)) as typeof frame;
        } catch {
          return;
        }

        switch (frame.type) {
          case "ready":
            delayRef.current = BACKOFF_MIN_MS;
            // Whatever moved while this console was disconnected was missed
            // outright — the server keeps no backlog — so a fresh connection
            // always re-reads once.
            //
            // It re-reads everything the cases below touch, which is the whole
            // point: a key this socket keeps fresh but does not re-read here is
            // a key that stays wrong for as long as the console is left open.
            // Technicians and the dashboard were exactly that — a colleague
            // going offline during a dropped connection stayed "Online" on the
            // manager's screen indefinitely.
            void queryClient.invalidateQueries({ queryKey: ticketKeys.all });
            void queryClient.invalidateQueries({
              queryKey: notificationKeys.all,
            });
            void queryClient.invalidateQueries({ queryKey: technicianKeys.all });
            void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
            break;
          case "technician.changed":
            // Somebody toggled their availability or changed their daily cap.
            // The frame names nobody: the console re-reads `GET /technicians`,
            // which applies territory scoping in SQL.
            //
            // Only the technician's own DECISION arrives this way. Whether
            // their phone is still reachable decays on a TTL server-side and
            // lands on the next refetch — publishing that would be one frame
            // per technician per ping, to say nothing anybody asked about.
            void queryClient.invalidateQueries({ queryKey: technicianKeys.all });
            break;
          case "notification.raised":
            // No id and no text in the frame — the bell is a count, and the
            // feed behind it applies the audience rule in SQL. All this can
            // honestly do is say "go and look".
            void queryClient.invalidateQueries({
              queryKey: notificationKeys.all,
            });
            // And tell whoever wants to say so out loud. The listener does its
            // own read: this frame still carries nothing worth showing.
            emit("notification.raised");
            break;
          case "ticket.changed":
            if (frame.ticketId) {
              void queryClient.invalidateQueries({
                queryKey: ticketKeys.detail(frame.ticketId),
              });
            }
            // Lists too: a status change moves a row between filter tabs and
            // changes the counts, so invalidating only the detail would leave
            // the board wrong while the drawer was right.
            void queryClient.invalidateQueries({ queryKey: ticketKeys.all });
            void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
            break;
          // 'ping' needs no reply — receiving it is already proof of life.
        }
      };

      socket.onclose = (event) => {
        socketRef.current = null;
        if (closedByUsRef.current) return;
        if (event.code === CLOSE_AUTH_FAILED) {
          // The token expired. `http.ts` refreshes on the next request and
          // writes a new one to the session, which re-runs this effect —
          // racing it with our own refresh would rotate the refresh token
          // twice and sign the user out.
          return;
        }
        scheduleReconnect();
      };
    }

    connect();

    return () => {
      closedByUsRef.current = true;
      clearTimer();
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        // Handlers first: closing fires `onclose`, which would otherwise queue
        // a reconnect for a socket we are deliberately ending.
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.close();
      }
    };
  }, [token, queryClient]);
}
