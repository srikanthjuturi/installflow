import { formatDateTime } from "@/utils/datetime";
import type {
  PartAction,
  PartRequest,
  PartRequestStatus,
} from "@/types/parts";
import { PART_REQUEST_STATUSES } from "@/types/parts";

/**
 * Pure status vocabulary for spare-part requests — Task 13 §5.7. All wording is
 * §5.10 PROPOSED copy, used as written.
 *
 * `actionsFor` reads the server's own `allowedActions` rather than re-deriving
 * the P4 state machine, so the console and `core.spare_parts.allowed_actions`
 * cannot drift: a new transition the API grows is simply not drawn until this
 * build learns its word, and an unknown word is dropped, never rendered.
 */

/** The request page. One place, so a row, its code link and a ticket's panel
 *  cannot disagree. Franchise staff only — there is no staff-console twin (R4). */
export const partRequestPath = (id: string) => `/franchise/parts/requests/${id}`;

export const PART_STATUS_LABEL: Record<PartRequestStatus, string> = {
  requested: "Requested",
  approved: "Approved",
  issued: "Issued",
  returned: "Returned",
  rejected: "Rejected",
};

/** Static classes — an interpolated colour class is never generated. A WORD
 *  always rides with the tint (`PartStatusBadge`), never the tint alone. */
export const PART_STATUS_CLASS: Record<PartRequestStatus, string> = {
  requested: "bg-info-bg text-info",
  approved: "bg-status-assigned-bg text-brand-400",
  issued: "bg-ok-bg text-ok",
  returned: "bg-surface-3 text-ink-2",
  rejected: "bg-warn-bg text-warn",
};

const REJECTED_AFTER_APPROVAL = "Rejected after approval";

/**
 * The badge's word. A request a facility cancelled after approving it (owner
 * ruling 2026-10-15, R2) reads *Rejected after approval* — the technician was
 * told it was coming, which is not the same news as a plain refusal. Same warn
 * class either way.
 */
export function partStatusLabel(
  r: Pick<PartRequest, "status" | "rejectedAfterApproval">
): string {
  return r.status === "rejected" && r.rejectedAfterApproval
    ? REJECTED_AFTER_APPROVAL
    : (PART_STATUS_LABEL[r.status] ?? r.status);
}

/** A status this build has never heard of still renders, neutrally. */
export function partStatusClass(status: string): string {
  return PART_STATUS_CLASS[status as PartRequestStatus] ?? "bg-surface-3 text-ink-2";
}

export const PART_ACTION: Record<PartAction, { label: string; danger?: boolean }> = {
  approve: { label: "Approve" },
  issue: { label: "Mark issued" },
  return: { label: "Log return" },
  reject: { label: "Reject", danger: true },
};

/** The order buttons are drawn in: forward steps first, the refusal last —
 *  the same order the server's `allowed_actions` sorts them in. */
const ACTION_ORDER: readonly PartAction[] = ["approve", "issue", "return", "reject"];

/**
 * The server's allowed actions, filtered to the four this build can draw, in a
 * fixed order. `canHandle` is presentation only (hard rule 8) — the portal
 * passes `has("parts.handle")`; nobody on the staff console ever does.
 */
export function actionsFor(
  r: Pick<PartRequest, "allowedActions">,
  canHandle: boolean
): PartAction[] {
  if (!canHandle) return [];
  return ACTION_ORDER.filter((a) => r.allowedActions.includes(a));
}

/** P7: an Other request still waiting names the category it could be added to. */
export function offersAddToCatalogue(
  r: Pick<PartRequest, "catalogueTarget">
): boolean {
  return r.catalogueTarget !== null;
}

/** Task 12 D22: the desk's default view — and what the server answers when no
 *  `status` is sent. */
export const DEFAULT_QUEUE_STATUSES = ["requested", "approved", "issued"] as const;

/** The *All* pill's value: every status, as the comma-set the API takes. */
export const ALL_STATUSES_PARAM = PART_REQUEST_STATUSES.join(",");

/** The queue's pills after the default (*On the desk*, which sends nothing). */
export const QUEUE_PILLS: { value: string; label: string }[] = [
  ...PART_REQUEST_STATUSES.map((s) => ({ value: s, label: PART_STATUS_LABEL[s] })),
  { value: ALL_STATUSES_PARAM, label: "All" },
];

/**
 * The request's trail, oldest first, in §5.10 wording. Built from what the
 * server stored — a line is present only when its step happened.
 *
 *   Raised by {technician} · {when}
 *   Approved by {name} · {when}
 *   Rejected by {name} · {when} — {reason}
 *   Cancelled after approval by {name} · {when} — {reason}
 *   Issued by {name} · {when}
 *   Old part received by {name} · {when}
 *
 * A request cancelled after approval carries one line for the decision, not
 * two: the server overwrites the decider on a rejection, so the original
 * approver is not on the wire and is not invented here.
 */
export function trailLines(r: PartRequest): { key: string; text: string }[] {
  const lines: { key: string; text: string }[] = [
    {
      key: "raised",
      text: `Raised by ${r.technicianName} · ${formatDateTime(r.createdAt)}`,
    },
  ];

  const by = (name: string | null) => name ?? "a facility user";

  if (r.status === "rejected") {
    const reason = r.rejectReason ? ` — ${r.rejectReason}` : "";
    lines.push({
      key: "rejected",
      text: `${
        r.rejectedAfterApproval ? "Cancelled after approval" : "Rejected"
      } by ${by(r.decidedBy)} · ${formatDateTime(r.decidedAt)}${reason}`,
    });
    return lines;
  }

  if (r.status === "approved" || r.status === "issued" || r.status === "returned") {
    lines.push({
      key: "approved",
      text: `Approved by ${by(r.decidedBy)} · ${formatDateTime(r.decidedAt)}`,
    });
  }
  if (r.status === "issued" || r.status === "returned") {
    lines.push({
      key: "issued",
      text: `Issued by ${by(r.issuedBy)} · ${formatDateTime(r.issuedAt)}`,
    });
  }
  if (r.status === "returned") {
    lines.push({
      key: "returned",
      text: `Old part received by ${by(r.returnedBy)} · ${formatDateTime(r.returnedAt)}`,
    });
  }
  return lines;
}
