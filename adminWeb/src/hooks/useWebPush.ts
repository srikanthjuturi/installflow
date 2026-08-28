import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { toast } from "@/components/ui/toast";
import {
  currentSubscription,
  isWebPushSupported,
  permissionState,
  subscribe,
  unsubscribe,
  type WebPushKeys,
} from "@/lib/webPush";
import {
  registerWebPush,
  unregisterWebPush,
  webPushKey,
} from "@/services/notifications";
import { useSession } from "@/store/session";

/**
 * Desktop alerts: whether this browser has them, and turning them on and off.
 *
 * Everything the toggle needs and nothing else. The state is deliberately five
 * distinct answers rather than a boolean, because four of them need different
 * words on screen — "your browser cannot do this", "this deployment has no
 * keys", "you blocked it and only you can unblock it" and "off" are not the
 * same message, and a switch that silently does nothing is the worst of them.
 */
export type WebPushState =
  /** No service worker or no PushManager — an old browser, or iOS Safari in a tab. */
  | "unsupported"
  /** This deployment has no VAPID key, so nothing could be sent. */
  | "unavailable"
  /** Refused at the browser level. Only the user can undo it, in site settings. */
  | "blocked"
  /** Available and not on. */
  | "off"
  /** Subscribed; the API knows where to reach this browser. */
  | "on";

export const webPushKeys = {
  publicKey: ["web-push", "key"] as const,
};

export function useWebPush() {
  const supported = isWebPushSupported();
  const signedIn = useSession((s) => s.signedIn);
  const queryClient = useQueryClient();

  const [subscription, setSubscription] = useState<WebPushKeys | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>(
    permissionState()
  );
  // Whether the browser has been asked what it already holds. Until it has,
  // the toggle must not claim "off" — that would flash the wrong state on
  // every page load for somebody who already turned alerts on.
  const [probed, setProbed] = useState(false);

  /** There is only something to ask when both halves are in place. */
  const canProbe = supported && signedIn;

  const { data: key, isPending: keyPending } = useQuery({
    queryKey: webPushKeys.publicKey,
    queryFn: webPushKey,
    select: (result: { publicKey: string }) => result.publicKey,
    // The pair is generated once per environment and rotating it is a
    // deliberate act with a redeploy behind it, so this never goes stale.
    staleTime: Infinity,
    enabled: canProbe,
    // Its absence is a state the toggle renders, not a failure to report.
    meta: { suppressErrorToast: true },
  });

  /**
   * Is the key still on its way?
   *
   * A DISABLED query reports `isPending` forever in TanStack Query — there is
   * nothing in flight and nothing ever will be — so asking it directly would
   * leave the toggle on its skeleton permanently for exactly the readers who
   * most need the explanation: a browser that cannot do this at all.
   */
  const keyLoading = canProbe && keyPending;

  /**
   * Derived rather than stored, so there is nothing to set when the answer is
   * already known: with no support or no session there is nothing to ask, and
   * settling that with a `setState` in an effect body would cascade a render
   * on every mount to reach a conclusion available synchronously.
   */
  const ready = !canProbe || probed;

  // What this browser already holds, and re-assert it to the API.
  useEffect(() => {
    if (!canProbe) return;
    let cancelled = false;

    void (async () => {
      const existing = await currentSubscription().catch(() => null);
      if (cancelled) return;
      setSubscription(existing);
      setPermission(permissionState());
      setProbed(true);

      // Re-register what the browser is holding. The row may be gone even
      // though the subscription is not — signing out and switching company
      // both delete it server-side — and without this the browser would look
      // subscribed while nothing could actually reach it.
      if (existing && permissionState() === "granted") {
        await registerWebPush({
          ...existing,
          userAgent: navigator.userAgent.slice(0, 255),
        }).catch(() => {
          // Offline, or the session ended mid-flight. The next page load
          // tries again; nothing here is worth interrupting anybody for.
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canProbe]);

  const enable = useMutation({
    meta: { errorTitle: "Couldn't turn desktop alerts on" },
    mutationFn: async () => {
      if (!key) throw new Error("Desktop alerts are not configured");
      const created = await subscribe(key);
      // Refused at the prompt. Not an error — the reader said no.
      if (!created) return null;
      await registerWebPush({
        ...created,
        userAgent: navigator.userAgent.slice(0, 255),
      });
      return created;
    },
    onSuccess: (created) => {
      setSubscription(created);
      setPermission(permissionState());
      if (created) return;
      // Refused at the browser's prompt. Blocking it outright leaves
      // `permission` at "denied" and the toggle explains itself; DISMISSING it
      // leaves "default", so without this the button would go back to "Turn
      // on" having apparently done nothing at all.
      toast.add({
        type: "info",
        title: "Your browser did not allow desktop alerts",
        description:
          "Nothing was turned on. Choose Allow when the browser asks, or change it in this site's notification settings.",
        timeout: 8_000,
      });
    },
  });

  const disable = useMutation({
    meta: { errorTitle: "Couldn't turn desktop alerts off" },
    mutationFn: async () => {
      const dropped = await unsubscribe();
      // Even with nothing to unsubscribe locally, tell the API — a browser can
      // lose the subscription object while the server still holds the row, and
      // that row is what keeps sending.
      await unregisterWebPush(dropped?.endpoint);
    },
    onSuccess: () => setSubscription(null),
  });

  let state: WebPushState;
  if (!supported) state = "unsupported";
  else if (!keyLoading && !key) state = "unavailable";
  else if (permission === "denied") state = "blocked";
  else if (subscription) state = "on";
  else state = "off";

  return {
    state,
    /** True until this browser has been asked what it already holds. */
    isLoading: !ready || keyLoading,
    isBusy: enable.isPending || disable.isPending,
    enable: enable.mutate,
    disable: disable.mutate,
    /** Drop everything, for signing out and switching company. */
    reset: useCallback(async () => {
      const dropped = await unsubscribe().catch(() => null);
      await unregisterWebPush(dropped?.endpoint).catch(() => {
        // Best effort: the caller is on its way out, and a failure here must
        // never stop somebody signing out.
      });
      setSubscription(null);
      queryClient.removeQueries({ queryKey: webPushKeys.publicKey });
    }, [queryClient]),
  };
}
