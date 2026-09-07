import type { Parameter, ServiceType } from "./product";

/**
 * Where a vendor-submitted product sits between asking and being usable.
 *
 * A vendor may add products to their own book but not price them: what a
 * technician earns is never shown to a vendor, and what a vendor is *charged*
 * is a term between them and the company rather than something they set for
 * themselves. So a submission waits, unpriced, until a National Head or an
 * Admin types both figures and approves it — or refuses it with a reason.
 *
 * Lowercase on the wire, matching every other closed vocabulary the API sends
 * as a state (`notifications.kind`, `ticket_events.kind`). `TicketStatus` is
 * capitalised and is the exception, not the model to copy — the display label
 * is `APPROVAL_LABELS` below.
 *
 * Every product that existed before this feature was backfilled as `approved`,
 * so nothing that used to be ticketable stopped being so.
 */
export type ApprovalStatus = "pending" | "approved" | "rejected";

/** Queue order: the backlog first, then the two settled states. */
export const APPROVAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
] as const satisfies readonly ApprovalStatus[];

/** What a person reads. The wire value is lowercase; a badge is not. */
export const APPROVAL_LABELS: Record<ApprovalStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

/**
 * One row of the approvals queue.
 *
 * FLAT, not a nested `ProductNode`: the queue is a table of products somebody
 * has to decide about, not a catalogue to browse. `nodePath` carries the
 * breadcrumb so a reviewer sees where the product lands without opening the
 * tree.
 */
export interface ProductSubmission {
  /** The product model's own id — the same id every other model route takes. */
  id: string;
  nodeId: string;
  /** Root first, including the node's own name: Electronics › TV › OLED. */
  nodePath: string[];
  vendorId: string;
  vendorName: string;
  name: string;
  serviceTypes: ServiceType[];
  capacity: string | null;
  warrantyMonths: number | null;
  notes: string | null;
  parameters: Parameter[];
  imageUrls: string[];
  approvalStatus: ApprovalStatus;
  /**
   * Both prices, and NOT masked here — unlike `ProductModel`, where
   * `technicianPayoutPaise` is withheld from a vendor. This endpoint carries a
   * National-Head rank floor, so its reader can never be one.
   *
   * Null on a first submission. They carry the LAST AGREED figures when a
   * vendor's edit sent an approved product back for review, so the reviewer
   * confirms a number rather than re-pricing from scratch.
   */
  technicianPayoutPaise: number | null;
  vendorPricePaise: number | null;
  rejectionReason: string | null;
  /**
   * How many technicians could actually take a job on this node — certified
   * here or on any ancestor.
   *
   * Shown because a vendor may file a product under a brand-new sub-category
   * nobody is certified on, and a job raised there escalates immediately with
   * nothing on any screen saying why. A zero turns that silent failure into
   * something the approver sees before they approve.
   */
  technicianCount: number;
  /** When it last ENTERED pending. Null on a product that never waited. */
  submittedAt: string | null;
  decidedAt: string | null;
  /** Null on a product nobody ever reviewed. Rendered as "—". */
  decidedByName: string | null;
}

export interface ApproveProductInput {
  id: string;
  technicianPayoutPaise: number;
  vendorPricePaise: number;
}

export interface RejectProductInput {
  id: string;
  reason: string;
}
