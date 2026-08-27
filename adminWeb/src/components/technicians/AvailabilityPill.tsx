import { cn } from "@/lib/utils";

/**
 * Whether a technician can actually be given a job right now.
 *
 * Three states, not two, because two different facts are involved and
 * collapsing them hides the one a manager needs:
 *
 *   Online       they want work AND a device has been reachable recently.
 *   Unreachable  they want work, but nothing has been heard from their phone.
 *                Assigning by hand still works; they may not see it for a while.
 *   Not taking   their own switch is off. Nothing will be offered to them, and
 *                only they can change that.
 *
 * "Unreachable" is the state worth having a word for. Reading it as offline
 * would suggest the technician chose it, and reading it as online would promise
 * a response that may not come.
 */
export function AvailabilityPill({
  acceptingWork,
  online,
}: {
  acceptingWork: boolean;
  online: boolean;
}) {
  const { label, tint } = !acceptingWork
    ? { label: "Not taking work", tint: "bg-surface-3 text-ink-2" }
    : online
      ? { label: "Online", tint: "bg-ok-bg text-ok" }
      : { label: "Unreachable", tint: "bg-warn-bg text-warn" };

  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-[11px] font-semibold",
        tint,
      )}
      // Colour never carries it alone — the words say the same thing.
      title={
        acceptingWork
          ? online
            ? "Accepting work, and their app has checked in recently"
            : "Accepting work, but their app has not checked in recently"
          : "Their availability switch is off"
      }
    >
      {label}
    </span>
  );
}
