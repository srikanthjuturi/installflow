import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";

import { toast } from "@/components/ui/toast";
import { chime, primeChime } from "@/lib/chime";
import { PAGE_MESSAGE, type PushMessage } from "@/lib/webPush";
import { useSession } from "@/store/session";
import { listNotifications } from "@/services/notifications";
import { notificationKeys } from "./useNotifications";
import { onStreamEvent } from "./useTicketStream";

/**
 * Saying an escalation out loud, while somebody is looking at the console.
 *
 * The other half of desktop alerts. The split with `public/sw.js` is strict:
 *
 *   * this tab is VISIBLE   -> a toast, from here
 *   * no tab is visible     -> an operating-system notification, from the worker
 *
 * Two gates on the same fact, asked from two places that agree, so nothing ever
 * appears twice. And a toast needs no permission, so the "console is open" half
 * works for everybody — turning desktop alerts on only adds the other half.
 *
 * ## Two triggers, one announcement
 *
 * A toast can be prompted by the websocket frame or by the service worker
 * handing over a push it decided not to show. Both are wired up on purpose:
 * the socket covers a browser that never granted permission, the push covers a
 * console whose socket has dropped. `seen` makes the overlap harmless — an id
 * is announced once, whichever arrived first.
 */

/** How many to read back when the socket says something happened. */
const LOOK_BACK = 5;

/** Long enough to read a line and click it; the bell holds it either way. */
const TOAST_MS = 10_000;

/**
 * The quiet window after a chime.
 *
 * A sweep raises one notification per overdue ticket in a single pass, so five
 * can arrive inside a second. One sound for the batch is the difference between
 * a console somebody keeps unmuted and one they do not.
 */
const CHIME_GAP_MS = 3_000;

export function useNotificationToasts(): void {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const soundOn = useSession((s) => s.notificationSound);

  // Ids already announced. A ref, not state: nothing renders from it, and it
  // must survive re-renders without resetting.
  const seen = useRef<Set<string>>(new Set());
  // Whether the first read has happened. Until it has, everything the feed
  // returns is history — signing in must not fire five toasts for events from
  // yesterday, so the first read only fills `seen`.
  const primed = useRef(false);
  // The toast action closes over `navigate`, but the effect below deliberately
  // subscribes once. A ref keeps the latest without tearing down the socket
  // listener every time the router hands back a new identity.
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  // Same reason as `navigateRef`: read inside a listener that subscribes once.
  const soundRef = useRef(soundOn);
  useEffect(() => {
    soundRef.current = soundOn;
  }, [soundOn]);

  /** True while the batch window from the last chime is still open. */
  const chimedRef = useRef(false);

  // Browsers refuse to make noise until the user has touched the page, so the
  // audio system is built on the first click or keypress rather than at the
  // moment a notification arrives — by then the gesture that would have
  // allowed it has long passed, and the first alert of the session would be
  // the one that stayed silent.
  useEffect(() => primeChime(), []);

  useEffect(() => {
    let cancelled = false;

    /** Show one, unless it has already been shown. */
    const announce = (
      id: string,
      title: string,
      description: string,
      to: string | undefined
    ) => {
      if (seen.current.has(id)) return;
      seen.current.add(id);
      // Once per announcement, and the sweeps raise several at a time — five
      // escalations landing together must turn one head, not play a chord.
      // `soundRef` rather than a dependency: re-subscribing the socket
      // listener every time somebody flips the switch would be a reconnect.
      if (soundRef.current && !chimedRef.current) {
        chimedRef.current = true;
        chime();
        window.setTimeout(() => {
          chimedRef.current = false;
        }, CHIME_GAP_MS);
      }
      toast.add({
        type: "info",
        title,
        description,
        timeout: TOAST_MS,
        priority: "high",
        actionProps: to
          ? { children: "View", onClick: () => navigateRef.current(to) }
          : undefined,
      });
    };

    /**
     * The socket said something happened but not what. Read the newest few and
     * announce whatever is new.
     *
     * `fetchQuery` rather than a bare call so two frames arriving together
     * share one request, and under its own key so the Notifications page's
     * cache is untouched.
     */
    const readAndAnnounce = async () => {
      const page = await queryClient.fetchQuery({
        queryKey: notificationKeys.latest(),
        queryFn: () => listNotifications({ page: 1, limit: LOOK_BACK }),
        staleTime: 0,
        gcTime: 30_000,
      });
      if (cancelled) return;

      if (!primed.current) {
        // First read of the session: everything here is already history.
        for (const row of page.rows) seen.current.add(row.id);
        primed.current = true;
        return;
      }

      // Oldest first, so several raised together read in the order they
      // happened rather than upside down.
      for (const row of [...page.rows].reverse()) {
        if (row.read) {
          // Dealt with on another screen or in another tab between the frame
          // and this read. Remember it so it is never announced later.
          seen.current.add(row.id);
          continue;
        }
        announce(row.id, row.title, row.detail, row.to);
      }
    };

    const stopListening = onStreamEvent("notification.raised", () => {
      // Hidden tabs stay silent: the service worker is showing an operating
      // system notification instead, and doing both is how one event becomes
      // two interruptions. The bell still updates — that is the invalidation
      // in `useTicketStream`, which runs either way.
      if (document.visibilityState !== "visible") return;
      void readAndAnnounce().catch(() => {
        // A failed read is not worth a second toast; the query cache's own
        // error handling already reports anything the reader must know about.
      });
    });

    /** The worker, handing over a push it chose not to show. */
    const onWorkerMessage = (event: MessageEvent) => {
      const message = event.data as PushMessage | undefined;
      if (!message || message.type !== PAGE_MESSAGE) return;
      // Content arrives in the push itself, so this path needs no read at all.
      const id = message.data?.id;
      if (!id) return;
      announce(id, message.title, message.body, message.data?.to);
    };

    navigator.serviceWorker?.addEventListener("message", onWorkerMessage);

    // Prime `seen` straight away rather than on the first frame, or the first
    // event after sign-in would be swallowed as "history".
    void readAndAnnounce().catch(() => {
      // Offline, or signed out mid-flight. The next frame primes it instead.
    });

    return () => {
      cancelled = true;
      stopListening();
      navigator.serviceWorker?.removeEventListener("message", onWorkerMessage);
    };
  }, [queryClient]);
}
