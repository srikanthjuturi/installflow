import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { BASE_URL } from "@/services/http";
import { useSession } from "@/store/session";
import { dashboardKeys } from "./useDashboard";
import { ticketKeys } from "./useTickets";

/**
 * Live ticket movement for the console and the vendor portal.
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
            void queryClient.invalidateQueries({ queryKey: ticketKeys.all });
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
