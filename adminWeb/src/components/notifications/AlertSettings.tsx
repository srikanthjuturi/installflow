import {
  Bell,
  BellOff,
  BellRing,
  Loader2,
  Volume2,
  VolumeX,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useWebPush, type WebPushState } from "@/hooks/useWebPush";
import { cn } from "@/lib/utils";
import { useSession } from "@/store/session";

/**
 * How this console tells you something happened: a sound, and an alert when
 * you are not looking at it.
 *
 * Here rather than in the topbar, and asked for by a click rather than on
 * arrival, because a permission prompt nobody went looking for is one people
 * dismiss on reflex — and browsers increasingly refuse to show a second one.
 * Somebody reading `/notifications` has already decided these events matter.
 *
 * The two rows are independent on purpose, and the order is the point. Sound
 * works for everybody with nothing to grant, so it is settled first; desktop
 * alerts need the browser's permission and may not be available at all. A
 * reader on a browser that cannot do push must still be able to turn the sound
 * off, which is why the second row is never gated behind the state of the first.
 *
 * The vendor portal renders the same page at `/portal/notifications`, so both
 * surfaces get this from one component.
 */

/** What each push state says, and what (if anything) can be done about it. */
const COPY: Record<
  WebPushState,
  { title: string; detail: string; action?: "enable" | "disable" }
> = {
  on: {
    title: "Desktop alerts are on",
    detail:
      "Escalations reach this computer even with the console closed. While it is open you will see them here instead.",
    action: "disable",
  },
  off: {
    title: "Desktop alerts are off",
    detail:
      "Turn them on to hear about escalations when the console is in another tab or shut. Your browser will ask first.",
    action: "enable",
  },
  blocked: {
    title: "Your browser is blocking alerts",
    detail:
      "Notifications were refused for this site. Only you can undo that — allow notifications in your browser's site settings, then come back.",
  },
  unsupported: {
    title: "This browser cannot show desktop alerts",
    detail:
      "It has no support for background notifications. The console will still show them here while it is open.",
  },
  unavailable: {
    title: "Desktop alerts are not available",
    detail:
      "This deployment has no notification keys configured. The console will still show events here while it is open.",
  },
};

const ICON: Record<WebPushState, typeof Bell> = {
  on: BellRing,
  off: Bell,
  blocked: BellOff,
  unsupported: BellOff,
  unavailable: BellOff,
};

export function AlertSettings() {
  const { state, isLoading, isBusy, enable, disable } = useWebPush();
  const soundOn = useSession((s) => s.notificationSound);
  const setSound = useSession((s) => s.setNotificationSound);

  const copy = COPY[state];
  const Icon = ICON[state];
  const isOn = state === "on";

  return (
    <div className="mb-3.5 divide-y divide-line rounded-lg border border-line bg-surface">
      {/* Sound: no permission, no support question, so it never waits. */}
      <Row
        icon={soundOn ? Volume2 : VolumeX}
        tinted={soundOn}
        title={soundOn ? "Sound is on" : "Sound is off"}
        detail={
          soundOn
            ? "A short chime when something arrives while this tab is open."
            : "New events arrive without a sound. The toast still appears."
        }
        action={
          <Button
            variant="outline"
            size="sm"
            className={cn(
              !soundOn &&
                "border-brand-400 bg-surface text-brand-500 hover:bg-brand-100"
            )}
            onClick={() => setSound(!soundOn)}
          >
            {soundOn ? "Turn off" : "Turn on"}
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex items-center gap-3 px-3.5 py-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-full max-w-md" />
          </div>
        </div>
      ) : (
        <Row
          icon={Icon}
          tinted={isOn}
          title={copy.title}
          detail={copy.detail}
          action={
            copy.action ? (
              <Button
                variant="outline"
                size="sm"
                // Same reason as the button beside it: `outline` on a page
                // background has no visible boundary — see TerritoryPage.
                className={cn(
                  !isOn &&
                    "border-brand-400 bg-surface text-brand-500 hover:bg-brand-100"
                )}
                disabled={isBusy}
                onClick={() =>
                  copy.action === "enable" ? enable() : disable()
                }
              >
                {isBusy ? (
                  <>
                    <Loader2 data-icon="inline-start" className="animate-spin" />
                    Working…
                  </>
                ) : copy.action === "enable" ? (
                  "Turn on"
                ) : (
                  "Turn off"
                )}
              </Button>
            ) : null
          }
        />
      )}
    </div>
  );
}

interface RowProps {
  icon: typeof Bell;
  tinted: boolean;
  title: string;
  detail: string;
  action: React.ReactNode;
}

function Row({ icon: Icon, tinted, title, detail, action }: RowProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-3.5 py-3">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          tinted ? "bg-brand-100 text-brand-500" : "bg-surface-2 text-ink-3"
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-ink-3">{detail}</p>
      </div>
      {action}
    </div>
  );
}
