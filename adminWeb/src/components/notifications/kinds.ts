import {
  AlertTriangle,
  Bell,
  Clock,
  MailX,
  Play,
  ScanLine,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { NotificationKind } from "@/services/notifications";

export interface KindMeta {
  icon: LucideIcon;
  /** Static classes — an interpolated colour class is never generated. */
  wrap: string;
  label: string;
}

/**
 * How each kind of event presents itself: an icon, a tint, and the word for it.
 *
 * One table, read by both the row and the filter, so a category cannot be
 * called one thing in the list and another in the control that hides it.
 */
export const KIND: Record<NotificationKind, KindMeta> = {
  escalation: {
    icon: AlertTriangle,
    wrap: "bg-danger-bg text-danger",
    label: "Escalation",
  },
  serial_mismatch: {
    icon: ScanLine,
    wrap: "bg-danger-bg text-danger",
    label: "Serial mismatch",
  },
  ai: {
    icon: ScanLine,
    wrap: "bg-status-ai-review-bg text-status-ai-review",
    label: "AI verification",
  },
  force_close: {
    icon: ShieldCheck,
    wrap: "bg-warn-bg text-warn",
    label: "Force closure",
  },
  slot: { icon: Clock, wrap: "bg-info-bg text-info", label: "Slot" },
  invite_expired: {
    icon: MailX,
    wrap: "bg-warn-bg text-warn",
    label: "Invite expired",
  },
  // The two events here that are not a problem. Tinted like the statuses they
  // describe rather than like a warning: a manager scanning the feed should be
  // able to tell at a glance which rows need them and which are just news.
  job_started: {
    icon: Play,
    wrap: "bg-info-bg text-info",
    label: "Work started",
  },
  technician_joined: {
    icon: UserPlus,
    wrap: "bg-success-bg text-success",
    label: "Technician joined",
  },
};

const FALLBACK: KindMeta = {
  icon: Bell,
  wrap: "bg-surface-2 text-ink-2",
  label: "Event",
};

/**
 * A kind this build has never heard of still renders.
 *
 * The server can grow a category before the console ships again, and an
 * `undefined.icon` would take the whole page down over a label.
 */
export function kindMeta(kind: string): KindMeta {
  return KIND[kind as NotificationKind] ?? FALLBACK;
}
