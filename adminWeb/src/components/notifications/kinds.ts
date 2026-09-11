import {
  AlertTriangle,
  BadgeCheck,
  BadgeX,
  Bell,
  CalendarClock,
  Clock,
  IndianRupee,
  MailX,
  PackagePlus,
  Play,
  ScanLine,
  ShieldCheck,
  Tags,
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
  // A vendor added a product and cannot raise a ticket against it until
  // somebody sets both prices. Work, not news — so it sits with the problems
  // rather than with the three below.
  product_submitted: {
    icon: PackagePlus,
    wrap: "bg-info-bg text-info",
    label: "Product submitted",
  },
  // The same, for a brand a vendor added: none of its products can carry it
  // until somebody says yes.
  brand_submitted: {
    icon: Tags,
    wrap: "bg-info-bg text-info",
    label: "Brand submitted",
  },
  // A technician asked to be paid, or said a payment has not arrived. Warn,
  // like the other rows that are a task with a fix — and only the payer (the
  // National Head, else an Admin) ever sees one: the server addresses it.
  redemption: {
    icon: IndianRupee,
    wrap: "bg-warn-bg text-warn",
    label: "Redemption",
  },
  // Warn rather than danger, the same call `ApprovalBadge` makes: danger is
  // spoken for by the rows about a customer already let down, and a rejected
  // product is a task with a fix.
  product_rejected: {
    icon: BadgeX,
    wrap: "bg-warn-bg text-warn",
    label: "Product rejected",
  },
  brand_rejected: {
    icon: BadgeX,
    wrap: "bg-warn-bg text-warn",
    label: "Brand rejected",
  },
  // A confirmed visit moved. Amber rather than red: the customer agreed to it,
  // so it is not a failure — but somebody is now expecting a technician on a
  // different day, and the vendor reading this feed is the party who had no
  // other way of finding out.
  rescheduled: {
    icon: CalendarClock,
    wrap: "bg-warn-bg text-warn",
    label: "Rescheduled",
  },
  // The events here that are not a problem. Tinted like the statuses they
  // describe rather than like a warning: a manager scanning the feed should be
  // able to tell at a glance which rows need them and which are just news.
  //
  // SIX kinds widen to a vendor's portal — `serial_mismatch`, `assigned`, and
  // both decisions on a product and on a brand. `vendor_id` on a notification
  // widens the audience and never narrows it, so every one of these lands in
  // the staff feed too; that is why their titles name the product, the brand or
  // the ticket rather than saying "your", which would be false on a manager's
  // screen.
  product_approved: {
    icon: BadgeCheck,
    wrap: "bg-success-bg text-success",
    label: "Product approved",
  },
  brand_approved: {
    icon: BadgeCheck,
    wrap: "bg-success-bg text-success",
    label: "Brand approved",
  },
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
