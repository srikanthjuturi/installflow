import {
  AlertTriangle,
  Bell,
  Clock,
  MailX,
  Play,
  ScanLine,
  ShieldCheck,
  UserCheck,
  UserPlus,
  UserX,
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
  // Nobody turned up and nobody said so. Red with the escalation: it is the
  // only row in this feed about a customer who has ALREADY been let down, and
  // the manager is the only person who can decide whether it was really one.
  no_show: {
    icon: UserX,
    wrap: "bg-danger-bg text-danger",
    label: "No-show",
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
  // The three events here that are not a problem. Tinted like the statuses
  // they describe rather than like a warning: a manager scanning the feed
  // should be able to tell at a glance which rows need them and which are just
  // news.
  //
  // `assigned` is the one the VENDOR also sees — it is the only kind besides a
  // serial mismatch that widens to their portal, because they raised the ticket
  // and somebody going is the first thing they have wanted to hear since.
  assigned: {
    icon: UserCheck,
    wrap: "bg-success-bg text-success",
    label: "Job accepted",
  },
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
