/**
 * A vendor's credit line with its company — see `api/app/models/vendor_credits.py`.
 *
 * The other end of the money from `types/credits.ts`, and a separate concept
 * sharing no table with it. Those credits are what the COMPANY pays the PLATFORM
 * for a ticket entering the system, charged at creation. This is what a VENDOR
 * owes the COMPANY for work delivered, charged when a ticket CLOSES and cleared
 * by paying. Both gates apply to the same vendor at intake, and either one alone
 * stops it.
 *
 * Every amount is PAISE. There is no "credits" figure anywhere here: a charge is
 * the ticket's own stamped vendor price, not a flat number of units, so rounding
 * it to whole credits would round somebody's bill.
 *
 *     limit      what the vendor may owe before its intake stops
 *     used       billed at closure, less every payment somebody confirmed
 *     reserved   the stamped price of tickets raised and not yet closed
 *     available  limit − used − reserved
 *
 * Closing a ticket moves its price from reserved to used, so available does not
 * move; cancelling frees the reservation and bills nothing. The only thing that
 * reduces a vendor's room is raising a ticket.
 */

/** Derived by the server from the timestamps; there is no status column. */
export const VENDOR_PAYMENT_STATES = [
  "to_pay",
  "waiting",
  "paid",
  "rejected",
  "cancelled",
] as const;
export type VendorPaymentState = (typeof VENDOR_PAYMENT_STATES)[number];

export const VENDOR_PAYMENT_STATE_LABELS: Record<VendorPaymentState, string> = {
  to_pay: "To pay",
  waiting: "Waiting",
  paid: "Paid",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

/**
 * Who started a payment.
 *
 * `vendor` is the QR flow — capped at UPI's per-transaction limit, and claimed
 * with a UTR and a screenshot, because two people can each see something: the
 * vendor knows they sent it, the company knows it arrived.
 *
 * `staff` is money that reached the company another way — NEFT, RTGS, cheque,
 * cash. Recorded on ONE person's word, because a bank statement is the only
 * evidence such a payment leaves on our side and the vendor is not a second
 * observer waiting to be asked. Uncapped, and it needs no UPI ID on the company.
 * The screens print which it was; they must never be shown as the same thing.
 */
export const VENDOR_PAYMENT_SOURCES = ["vendor", "staff"] as const;
export type VendorPaymentSource = (typeof VENDOR_PAYMENT_SOURCES)[number];

export const VENDOR_PAYMENT_SOURCE_LABELS: Record<VendorPaymentSource, string> = {
  vendor: "Paid by QR",
  staff: "Recorded",
};

/** What the Record-a-payment form offers. Free text on the wire — see the model. */
export const VENDOR_PAYMENT_METHODS = [
  "NEFT",
  "RTGS",
  "IMPS",
  "UPI",
  "Cheque",
  "Cash",
  "Other",
] as const;

export const VENDOR_CREDIT_ENTRY_KINDS = ["charge", "payment"] as const;
export type VendorCreditEntryKind = (typeof VENDOR_CREDIT_ENTRY_KINDS)[number];

export const VENDOR_CREDIT_ENTRY_KIND_LABELS: Record<
  VendorCreditEntryKind,
  string
> = {
  charge: "Ticket closed",
  payment: "Payment",
};

export const VENDOR_REQUEST_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
] as const;
export type VendorRequestStatus = (typeof VENDOR_REQUEST_STATUSES)[number];

export const VENDOR_REQUEST_STATUS_LABELS: Record<VendorRequestStatus, string> = {
  pending: "Waiting",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Withdrawn",
};

/** The vendor's own view of its line, from `GET /vendor-credit/me`. */
export interface VendorCredit {
  limitPaise: number;
  usedPaise: number;
  reservedPaise: number;
  /** Negative once closures have overtaken the line. */
  availablePaise: number;
  /** The next ticket is certainly refused. */
  paused: boolean;
  /** The most that can be paid now — what is owed, capped at UPI's limit. */
  maxPaymentPaise: number;
  /** False until the company has said where to send money. */
  paymentAvailable: boolean;
  openPaymentId: string | null;
  pendingRequestId: string | null;
}

export interface VendorCreditEntry {
  id: string;
  kind: VendorCreditEntryKind;
  /** Signed: a charge reads negative, a payment positive. */
  amountPaise: number;
  ticketId: string | null;
  ticketCode: string | null;
  paymentId: string | null;
  paymentCode: string | null;
  createdAt: string;
}

export interface VendorPayment {
  id: string;
  code: string;
  state: VendorPaymentState;
  amountPaise: number;
  source: VendorPaymentSource;
  /** How it moved. Null on the QR flow, where it is always UPI. */
  method: string | null;
  /** The day the money arrived — not the day it was recorded. Null on the QR flow. */
  receivedOn: string | null;
  note: string | null;
  /**
   * The company's UPI ID and name when this was asked for, frozen.
   *
   * Null on a staff record: a NEFT went to no UPI address, and saying it did
   * would assert a route the money never took.
   */
  upiId: string | null;
  payeeName: string | null;
  utr: string | null;
  requestedByLabel: string | null;
  claimedAt: string | null;
  claimedByLabel: string | null;
  confirmedAt: string | null;
  confirmedByLabel: string | null;
  rejectedAt: string | null;
  rejectedByLabel: string | null;
  rejectReason: string | null;
  cancelledAt: string | null;
  createdAt: string;
  /** Who is paying. On the list row too, because the ops queue spans vendors. */
  vendorName: string | null;
}

export interface VendorPaymentDetail extends VendorPayment {
  /**
   * The server's finished `upi://pay?…`. Only while `to_pay`, and only for the
   * vendor — staff are the payee, so a QR would ask them to pay themselves.
   */
  upiUri: string | null;
  /** The screenshot, as a link that dies in fifteen minutes. */
  proofUrl: string | null;
}

/** One vendor's line in the ops list. */
export interface VendorStanding {
  vendorId: string;
  vendorName: string;
  isActive: boolean;
  limitPaise: number;
  usedPaise: number;
  reservedPaise: number;
  availablePaise: number;
  paused: boolean;
  openPaymentId: string | null;
  openPaymentState: VendorPaymentState | null;
  pendingRequestId: string | null;
}

export interface VendorCreditRequest {
  id: string;
  status: VendorRequestStatus;
  currentLimitPaise: number;
  requestedLimitPaise: number;
  /** What was approved, which may be less than was asked. */
  grantedLimitPaise: number | null;
  note: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  decidedByLabel: string | null;
  rejectReason: string | null;
  vendorName: string | null;
  createdAt: string;
}

export interface VendorCreditCounts {
  waiting: number;
  pendingRequests: number;
}

export interface RecordVendorPaymentInput {
  vendorId: string;
  amountPaise: number;
  method: string;
  /** ISO date — the day it ARRIVED, which the recorder chooses. */
  receivedOn: string;
  reference?: string;
  note?: string;
  proof?: { blobName: string; fileName?: string };
}

export interface ClaimVendorPaymentInput {
  id: string;
  utr: string;
  proof: { blobName: string; fileName?: string };
}
