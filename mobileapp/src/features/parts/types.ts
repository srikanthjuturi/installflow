/**
 * Spare parts on a job — Task 15, over Task 12's technician API.
 *
 * The technician only RAISES a request; the franchise's parts store approves,
 * issues and takes the old part back. There is no money and no stock here.
 */

export type PartRequestStatus = 'requested' | 'approved' | 'rejected' | 'issued' | 'returned';

export interface PartRequest {
  id: string;
  /** `RGT-SPR-0007`. */
  code: string;
  /** The part's name as the catalogue (or the technician) spelled it — data, never translated. */
  partName: string;
  /** Typed by the technician rather than picked from the list. */
  isOther: boolean;
  note: string | null;
  /**
   * A plain string on purpose: a status newer than this build must render as
   * "Updated" (`UNKNOWN_PILL`), not break the card.
   */
  status: string;
  /** ISO instants — worded at render, never here. */
  createdAt: string;
  decidedAt: string | null;
  rejectReason: string | null;
  /** Owner ruling R2: rejected after it had been approved. */
  rejectedAfterApproval: boolean;
  issuedAt: string | null;
  issueNote: string | null;
  returnedAt: string | null;
}

export interface CataloguePart {
  id: string;
  name: string;
}

export interface JobParts {
  /**
   * False = the job's franchise has no facility admin or operator (R4).
   * NULL = the server did not say, and is read as enabled.
   */
  partsEnabled: boolean | null;
  /** The server's word on whether a request can be raised right now. */
  canRequest: boolean;
  /** Flat, de-duplicated, sorted by the server. Empty when `canRequest` is false. */
  catalogue: CataloguePart[];
  requests: PartRequest[];
}
