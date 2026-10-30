import type { ServiceType } from "./product";
import type { TicketSpeed, TicketTravel } from "./allowances";
import type { PartRequest } from "./parts";

/** Ticket status. Eleven values — the prototype's nine plus Awaiting Customer
 *  and (Task 12) Awaiting Part.
 *
 *  Two are worth spelling out, because the names do not carry their meaning:
 *
 *    Slot Pending  raised, but nobody has agreed a time. No technician has been
 *                  told it exists.
 *    Awaiting Customer  the technician has finished and uploaded proof, and the
 *                  customer has been sent a link to confirm it. The customer
 *                  closes a job here, not the technician.
 *    New           the slot is locked and the ticket is in the pool. Eligible
 *                  technicians can see it; none has accepted.
 *
 *  Awaiting Part  the technician started the job and asked for a spare part
 *                  that is not yet issued. NON-terminal; `In Progress` again
 *                  once no request is waiting. A manager can still reschedule
 *                  it (`isReschedulable`) but it is never "waiting on the
 *                  customer" (`isTimeChoosable`).
 *
 *  There is no state between New and Assigned — Assigned already means somebody
 *  took it.
 */
export const TICKET_STATUSES = [
  "New",
  "Slot Pending",
  "Assigned",
  "In Progress",
  "Awaiting Part",
  "Awaiting Customer",
  "AI Review",
  "Escalated",
  "Closed",
  "Force-Closed",
  "Cancelled",
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

/**
 * The three statuses a ticket never leaves. Mirrors TERMINAL_STATUSES in
 * `api/app/core/tickets.py`.
 *
 * A ticket here is answered for. Nothing is left to force-close and nobody is
 * left to send, so the controls that do either are not offered — the point is
 * that the record has stopped moving, which is also why `slaState` reads
 * `done` rather than `ok`.
 */
export const TERMINAL_TICKET_STATUSES: readonly TicketStatus[] = [
  "Closed",
  "Force-Closed",
  "Cancelled",
];

export const isTerminalTicketStatus = (status: TicketStatus): boolean =>
  TERMINAL_TICKET_STATUSES.includes(status);

/**
 * The two statuses that mean a ticket is actually CLOSED — Closed or
 * Force-Closed. Mirrors `closed_in()` in `api/app/features/tickets/service.py`:
 * both are ways a job ends up finished, and deliberately not `Cancelled`,
 * which is a different outcome with no closure to review.
 *
 * One expression, so the high-priority board's badge and its "Closed Tickets"
 * view cannot disagree about what "closed" means.
 */
export const CLOSED_TICKET_STATUSES: ReadonlySet<TicketStatus> = new Set([
  "Closed",
  "Force-Closed",
]);

/**
 * Whether a time can still be set for this ticket — by the customer from their
 * link, or by a manager rescheduling. Mirrors `time_is_choosable` in
 * `api/app/core/slots.py`; the server treats those as one question and so
 * does this.
 *
 * Past `Assigned` the technician is on site, so a job started without a time
 * is NOT waiting on the customer. `Escalated` counts only with nobody holding
 * it: with a technician it means the customer refused the closure, and a new
 * time would turn a complaint into an appointment.
 */
const TIME_CHOOSABLE_STATUSES: readonly TicketStatus[] = [
  "Slot Pending",
  "New",
  "Assigned",
  "Escalated",
];

export const isTimeChoosable = (ticket: {
  status: TicketStatus;
  technicianId: string | null;
}): boolean =>
  TIME_CHOOSABLE_STATUSES.includes(ticket.status) &&
  !(ticket.status === "Escalated" && ticket.technicianId !== null);

/**
 * Whether a manager's "Change the time" is still on offer. Mirrors the API's
 * reschedulable set: everything `isTimeChoosable` says, PLUS `Awaiting Part`
 * (Task 12 D8 — a revisit is booked with the existing reschedule).
 *
 * Never fold `Awaiting Part` into `TIME_CHOOSABLE_STATUSES`: that set mirrors
 * `core.slots.CHOOSABLE_STATUSES`, which Task 12 leaves alone, and the slot
 * strip and the technician panel would start telling a manager the customer
 * is picking a time on a job that is half finished.
 */
export const isReschedulable = (ticket: {
  status: TicketStatus;
  technicianId: string | null;
}): boolean => isTimeChoosable(ticket) || ticket.status === "Awaiting Part";

/**
 * Task 18 (H3): the statuses a ticket can be handed to another franchisee FROM
 * — `HANDOVER_STATUSES` in `api/app/core/franchise_handover.py` — provided
 * nobody holds it. Presentation only: the server decides.
 */
export const HANDOVER_TICKET_STATUSES: readonly TicketStatus[] = [
  "New",
  "Slot Pending",
  "Escalated",
];

/** One franchisee in the hand-over picker, with the numbers that make it a choice. */
export interface FranchiseeOption {
  id: string;
  name: string;
  code: string;
  isHome: boolean;
  kind: "internal" | "external";
  /** The ticket's present franchisee: shown, never selectable. */
  isCurrent: boolean;
  ownsPincode: boolean;
  /** Active, certified for the job, with room on the day (and covering the
   *  pincode, for its own owner). */
  eligibleTechnicians: number;
  /** The subset of `eligibleTechnicians` accepting work now. */
  onlineTechnicians: number;
}

export type HandOverBlocker = "TICKET_ASSIGNED" | "TICKET_NOT_ASSIGNABLE";

/** `GET /tickets/:id/franchisee-options`. */
export interface FranchiseeOptions {
  ticketId: string;
  code: string;
  pincode: string;
  currentFranchiseeId: string;
  pincodeOwnerId: string;
  routingOverride: boolean;
  canHandOver: boolean;
  blocker: HandOverBlocker | null;
  /** Can the pool still offer this ticket now (an escalated ticket whose window
   *  has closed cannot be put back). */
  slotOffered: boolean;
  /** Empty when `canHandOver` is false. */
  options: FranchiseeOption[];
}

/** `POST /tickets/:id/franchisee`. */
export interface HandToFranchiseeResult {
  ticket: TicketDetail;
  /** Phones the push reached. */
  notified: number;
  /** An escalated ticket left the queue for the pool. */
  backInPool: boolean;
}

/**
 * SLA state. `done` means the window closed with the job complete — it is a
 * terminal state, not a healthy one, so it never sorts with `ok`.
 *
 * Derived by the API on every read, never stored: it changes with the clock,
 * and a stored copy would be wrong the moment nobody looked at it.
 */
export type SlaState = "ok" | "warn" | "breach" | "done";

/**
 * Hours. **The slot must START within this long of the ticket being raised.**
 *
 * Mirrors SERVICE_LEVEL_HOURS in `api/app/core/tickets.py`. The anchor was a
 * real decision: the requirement doc has the customer picking "a slot within
 * the ticket's SLA window", the prototype said "24 hours from slot
 * confirmation", and those give opposite answers to "can a ticket go late while
 * the customer is silent?". It can — silence burns the window, which is what
 * makes "Slot not confirmed > 6h" a number worth showing.
 */
export const SERVICE_LEVELS = [12, 24, 36, 48] as const;
export type ServiceLevelHours = (typeof SERVICE_LEVELS)[number];

/**
 * A7: where the unit was bought. Mirrors `PURCHASE_MODES` in
 * `api/app/core/tickets.py`. `purchasePlatformId`/`purchasePlatformName` are
 * null together unless this is `"online"`.
 */
export const PURCHASE_MODES = ["online", "offline"] as const;
export type PurchaseMode = (typeof PURCHASE_MODES)[number];

export interface Ticket {
  id: string;
  /** `INST-240912`. What ops quote on the phone. */
  code: string;

  /* Everything below is stored by ID and resolved to a name by the API. The
     mock stored names, so renaming anything in the product master silently
     orphaned every ticket that referenced it. */
  vendorId: string;
  vendorName: string;
  subcategoryId: string;
  /** The parent category — the level the console groups the column by. */
  categoryName: string;
  subcategoryName: string;
  /** The whole breadcrumb, root first — `["Electronics", "TV", "Android TV"]`.
   *  `categoryName` is its first entry and `subcategoryName` its last; this is
   *  what a deep catalogue puts in between. */
  nodePath: string[];
  modelId: string;
  modelName: string;
  /** The model's brand, read live like `modelName`. Null only if the model
   *  itself can no longer be resolved. */
  brandName: string | null;

  /** Constrained to what the chosen model declares it supports. */
  serviceType: ServiceType;
  /** The customer's problem. Present for Tech Visit and Service, null otherwise. */
  description: string | null;
  /**
   * A2: a manager or vendor flagging this job for attention on the board.
   * No SLA, no routing, no eligibility consequence — a flag, nothing else.
   */
  isHighPriority: boolean;
  /**
   * A7: where the unit was bought. Always one of `PURCHASE_MODES`;
   * `purchasePlatformId`/`purchasePlatformName` are null together unless
   * this is `"online"`.
   */
  purchaseMode: PurchaseMode;
  purchasePlatformId: string | null;
  /** Resolved on read, like every other `*Name` beside an id — the platform
   *  can be renamed without rewriting every ticket that named it. */
  purchasePlatformName: string | null;
  /**
   * The EXPECTED serial, off the invoice — not the one the technician
   * photographs on site. A mismatch between the two is what AI review is for.
   */
  serialNumber: string | null;
  /**
   * What the technician actually READ on site, and how they read it — `scanned`
   * off a barcode or `manual` off the label. Null until proof is submitted.
   *
   * Never editable. `serialNumber` above is the order and can be corrected;
   * this is evidence of what was on the unit, and correcting the order must
   * not quietly rewrite what it disagreed with.
   */
  observedSerial: string | null;
  observedSerialSource: "scanned" | "manual" | null;
  /** Derived server-side from the two above on every read, never stored. */
  serialMismatch: boolean;

  /** Masked from technicians until they accept; ops always sees it. */
  customerName: string;
  customerPhone: string;
  /** A6: a second number for the same customer. Masked on the same terms as
   *  `customerPhone` until a technician accepts. */
  customerAltPhone: string | null;
  address: string;
  city: string;
  state: string;
  pincode: string;
  /**
   * Null when the address was typed rather than picked off a map — every
   * ticket raised before this existed, and everything the Excel and API intake
   * channels raise.
   *
   * Worth surfacing because it decides which rule the technician's proof photo
   * is judged by: a ticket with a point is verified by distance, one without
   * by pincode. "Why was this technician refused and that one not" is
   * otherwise unanswerable from the console.
   */
  latitude: number | null;
  longitude: number | null;

  /** ISO date. */
  expectedDate: string;
  serviceLevelHours: ServiceLevelHours;
  /** The customer-confirmed slot, or null while it is still Slot Pending. */
  slotStart: string | null;
  slotEnd: string | null;
  slaDueAt: string;
  slaState: SlaState;

  status: TicketStatus;
  /** Null until a technician accepts — first-accept-wins. */
  technicianId: string | null;
  technicianName: string | null;
  /** Their photo, for the assigned panel's disc. Null falls back to initials. */
  technicianPhotoUrl: string | null;

  /**
   * The ticket's OWN franchisee context, as the server scopes it (Task 05).
   *
   * `franchiseeId` / `franchiseeName` — whose pincodes this ticket was raised
   * under, with null meaning the technician is an internal (home) one. Withheld
   * from a vendor principal: whose technicians a vendor's jobs fall to is an
   * operational fact, not the vendor's business.
   *
   * `technicianType` — `"employee"` (paid through salary, no per-job payout)
   * or `"freelancer"`. Staff screens use it for the force-close payout box
   * (§5.10): an employee's closure pays nothing per job.
   */
  franchiseeId: string | null;
  franchiseeName: string | null;
  /**
   * Task 18: a person, not the pincode, chose `franchiseeId` — the ticket was
   * handed to another franchisee, and the pincode half of eligibility is waived
   * for it. Null for a vendor (with the franchisee). Optional so a payload from
   * before the field existed reads as "not handed over".
   */
  routingOverride?: boolean | null;
  technicianType: "employee" | "freelancer" | null;

  /**
   * PAISE. What a manager attached to a re-notification after nobody accepted.
   *
   * Null means no bonus was ever funded, which is a different claim from ₹0 —
   * render it through `moneyPaise`, which says "—". Present on every ticket,
   * set on almost none.
   */
  bonusPaise: number | null;
  /**
   * The four chips Bonus Setup offers, in PAISE and ascending — **this
   * ticket's**, frozen at intake.
   *
   * Not the company's. `bonus_bands_paise` is one of the rules a product
   * category may override, and this is the one screen that spends them; read
   * from `GET /settings/rules` it would show the company figures and
   * configuring a category would silently do nothing.
   */
  bonusBandsPaise: number[];

  /**
   * PAISE. What the vendor is charged for this job, stamped at intake from the
   * product model — so a later repricing never restates an old ticket.
   *
   * Everyone who can see the ticket sees this, the vendor included: it is their
   * own price, and there is nothing to hide from the party paying it.
   *
   * `number | null` since Task 04 nulls it for a franchise principal too (index
   * §6, owner ruling 2026-10-15 R6): how much the vendor is billed is a staff
   * and vendor fact, not the franchisee's — they see their technician's side of
   * the money, which is what the pool screens are about. `null` is rendered as
   * `—`, the same typographic answer the payout gap gets.
   */
  vendorPricePaise: number | null;
  /**
   * PAISE. What the technician is paid, stamped at intake.
   *
   * `null` NEVER means unpriced — the column is NOT NULL. It means the caller
   * is a **vendor**: the server withholds this from them, because what we pay a
   * technician is not part of what the vendor bought. Ops always get a number.
   *
   * So a `null` check here is "did the server send it", not a permission
   * decision — that is enforced server-side (hard rule 8).
   */
  technicianPayoutPaise: number | null;

  /** Delivery of the "pick a time" message. `not_needed` when ops set the slot. */
  slotRequestStatus: "not_needed" | "pending" | "sent" | "failed";
  /** WhatsApp's own words when it refused, so ops can act rather than guess. */
  slotRequestError: string | null;
  /**
   * When the CUSTOMER picked. Null when ops entered the slot themselves —
   * which is how the console tells "they chose this" from "we did".
   */
  slotConfirmedAt: string | null;
  /**
   * The scheduling link, so ops can copy it out when WhatsApp refuses and read
   * it down the phone. Present only while the slot is still the customer's to
   * pick; it disappears the moment it is used.
   */
  slotLink: string | null;

  /**
   * The customer's verdict, from the confirmation link.
   *
   * `customerConfirmedAt` is what says whether there IS one — a null rating
   * means "confirmed without rating", which is a different claim from "has not
   * answered yet", and rendering either as 0 would invent a bad score.
   */
  customerRating: number | null;
  customerFeedback: string | null;
  customerConfirmedAt: string | null;
  /** They answered and said the work is NOT finished. */
  customerRefused: boolean;

  createdAt: string;
}

/**
 * One entry in a ticket's audit trail.
 *
 * Built by the API from stored facts only. The mock derived a seven-event trail
 * from `status` alone — "Notified 6 eligible technicians" for a ticket nothing
 * had notified — so this list is currently short, and honest. It grows as the
 * slices that cause the events land.
 */
export interface TimelineEvent {
  at: string;
  /** Mirrors EVENT_KINDS in the API's ticket_event model. */
  kind:
    | "created"
    | "slot_requested"
    | "slot_confirmed"
    | "confirmation_sent"
    | "status_changed"
    | "assigned"
    | "started"
    | "feedback_requested"
    | "completed"
    | "feedback_received"
    | "reopened"
    | "serial_mismatch"
    | "serial_corrected"
    | "reminded"
    // Pre-existing gap, not new here: the API has written this since
    // `b4e17c92a08d` and the union never learned about it, so every "we told
    // the customer who is coming" row has been drawing the `created` icon.
    // Worth closing now because the reschedule work makes it FIRE MORE OFTEN —
    // the sweep re-arms after a slot moves, so a rescheduled visit gets a
    // second one.
    | "customer_notified"
    | "escalated"
    | "bonus_added"
    | "released"
    | "no_show"
    | "force_closed"
    | "rescheduled"
    | "penalty_reversed"
    // Task 11 — the speed allowance was measured when the customer confirmed.
    | "speed_settled"
    // Task 12 — the spare-part trail. Titles are the server's (`part_rejected`
    // reads *Approved spare part cancelled* when it had been approved).
    | "part_requested"
    | "part_approved"
    | "part_rejected"
    | "part_issued"
    | "part_returned"
    // Task 03/18 — the ticket moved to another franchisee (carve-out, release
    // re-stamp, or a manager's hand-over). Title is the server's.
    | "franchisee_changed";
  title: string;
  /**
   * WHO caused it, as a value rather than as wording.
   *
   * `title` says the same thing in English — "Technician accepted" against
   * "Assigned by a manager" — but anything elsewhere on the page that needs
   * the distinction reads this instead, because a display string is
   * presentation and free to change.
   */
  actorKind: "staff" | "technician" | "customer" | "vendor" | "system";
  /** Both nullable: a system event has no actor, and some have no detail. */
  by: string | null;
  note: string | null;
}

export interface TicketDetail extends Ticket {
  timeline: TimelineEvent[];
  /**
   * PAISE. What the technician was ACTUALLY credited, read from the ledger.
   *
   * Usually equal to `technicianPayoutPaise`, but a force-closure credits an
   * amount the manager chose — often less than the job's price, sometimes
   * nothing at all.
   *
   * Null means nothing has been credited yet: every open ticket, and also a
   * force-closure paid at zero. Render through `moneyPaise` — "—", never ₹0,
   * which would assert a payment of zero was made. Withheld from a vendor, the
   * same as the payout it settles.
   */
  technicianCreditedPaise: number | null;
  /**
   * Every penalty charged on this ticket, oldest first. Staff only — always
   * empty on the vendor portal, who is not a party to what a technician pays.
   */
  penalties: TicketPenalty[];
  /**
   * Who is responsible for reviewing those penalties: the ticket's Area
   * Manager, else its Regional Head, else a National Head, else an Admin.
   * It NAMES them; anyone at that rank or above who can see the ticket may act.
   * Null when there are no penalties.
   */
  penaltyReviewer: PenaltyReviewer | null;
  /**
   * The travel allowance frozen at accept (Task 10 §4.4), or null — nobody
   * holds the job, it was accepted before Task 10, or the server withholds it
   * (a vendor, or facility staff). Visibility is the SERVER'S: never gate the
   * panel on a surface here (company staff and the franchise admin get it).
   */
  travel: TicketTravel | null;
  /**
   * The speed allowance for this job (Task 11 §4.11), null when no rule was
   * frozen at accept — and for a vendor or facility staff.
   */
  speed: TicketSpeed | null;
  /**
   * This ticket's spare-part requests, oldest first (Task 12 §4.7). `[]` for a
   * vendor — the way `penalties` is withheld — and a franchise principal sees
   * only its own franchisee's. The return photo's link is signed per read.
   */
  partRequests: PartRequest[];
}

/**
 * One penalty charged on a ticket, and whether a manager gave it back.
 *
 * A ticket can carry several — each technician who cancels pays their own
 * band, and a confirmed no-show is one more — so a reversal names ONE by `id`.
 * A reversal is always the full amount.
 */
export interface TicketPenalty {
  /**
   * Task 11 §4.6 — `speed_penalty` is a penalty too: same Reverse button, same
   * endpoint. Absent on a server older than Task 11, which reads as `penalty`.
   */
  kind?: "penalty" | "speed_penalty";
  /** The ledger entry's id — what `reversePenalty` is called with. */
  id: string;
  technicianName: string;
  /** PAISE, positive — a debit to the technician. */
  amountPaise: number;
  /** As recorded when charged — "Cancel 2–4h before slot", "No-show". */
  reason: string;
  chargedAt: string;
  /** All three null while the penalty stands. */
  reversedAt: string | null;
  reversedByName: string | null;
  reversalReason: string | null;
  /**
   * May THIS caller give it back — the server answers per ROW, not per
   * caller (Task 05's `TicketPenaltyOut.canReverse`). Admin/NH on every
   * franchisee; RH/AM on the home franchisee's rows only; always false for a
   * franchise principal — the ticket's reverse door is staff-only.
   *
   * A row reading false is not a hidden button: the renderer says WHO works
   * the money instead (`Managed by …`), because "no button, no explanation"
   * reads as a bug rather than a boundary. Never gate this in the client with
   * a feature key — a feature key knows your role, not whose row you sit on.
   */
  canReverse: boolean;
}

export interface PenaltyReviewer {
  name: string;
  role: "area_manager" | "regional_head" | "national_head" | "admin";
}

/**
 * One proof image as ops and the vendor see it.
 *
 * Photographs of the inside of a customer's home, so the container is private
 * and `url` is signed and short-lived — minted per read and useless within
 * minutes. Never cache one; re-read the list instead.
 */
export interface TicketProof {
  kind: "barcode" | "serial" | "photos" | "live";
  /** 1-based within its kind. Only `photos` ever goes past 1. */
  ordinal: number;
  capturedAt: string;
  /** Null when blob storage is unconfigured — the record stands, the picture does not. */
  url: string | null;
  /** Where the phone was for the live shot; null on the other three. */
  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;
  /**
   * What the phone reverse-geocoded its position to. Compare it with the
   * ticket's own pincode when a customer disputes that anybody attended.
   */
  devicePincode: string | null;
}

export interface CorrectSerialInput {
  id: string;
  serialNumber: string;
  /** "invoice says 88417" explains a correction that a bare value never will. */
  reason?: string | null;
}

/**
 * Correcting what the technician TYPED on site, when that was the slip.
 * Manager-only, and the reason is required: it edits evidence.
 */
export interface CorrectReadingInput {
  id: string;
  observedSerial: string;
  reason: string;
}

/** `GET /tickets/:id/serial-check` — would that correction be accepted? */
export interface SerialCheck {
  /** Also true when the product has no serial list: that is unchecked. */
  accepted: boolean;
  /** The sentence Save would refuse with, word for word. */
  message: string | null;
}

export interface CreateTicketInput {
  vendorId: string;
  subcategoryId: string;
  modelId: string;
  serviceType: ServiceType;
  description?: string | null;
  serialNumber?: string | null;
  customerName: string;
  customerPhone: string;
  /** A6: a second number for the same customer. Optional — most tickets
   *  carry one. */
  customerAltPhone?: string | null;
  address: string;
  city: string;
  state: string;
  pincode: string;
  /**
   * Where the address is, when it was picked from the search box rather than
   * typed. Both or neither — the API refuses one without the other.
   *
   * Omitting them is normal, not a degraded ticket: it is what the Excel and
   * API intake channels will always do. What they buy is the proof check —
   * with a point, the technician's site photo is verified by DISTANCE from it;
   * without one, by pincode equality, which passes from the wrong street.
   */
  latitude?: number | null;
  longitude?: number | null;
  expectedDate: string;
  serviceLevelHours: ServiceLevelHours;
  slotStart?: string | null;
  slotEnd?: string | null;

  /** A2: flag this job for attention on the board. Defaults to `false`
   *  server-side when omitted. */
  isHighPriority?: boolean;
  /** A7: where the unit was bought. Defaults to `"offline"` server-side
   *  when omitted. */
  purchaseMode?: PurchaseMode;
  /** Only meaningful when `purchaseMode` is `"online"` — the server refuses
   *  one set alongside `"offline"`. */
  purchasePlatformId?: string | null;
  /** E1: free text answering "where was it bought", read two ways by the
   *  server depending on `purchaseMode` — the offline store name, or the
   *  online "Others" platform name when no `purchasePlatformId` is sent
   *  alongside it. Max 120 chars, trimmed by the client before sending. */
  purchasePlatformName?: string | null;
}

/* ── the bulk importer ─────────────────────────────────────────────────── */

/**
 * One row the importer will not raise a ticket for, and why.
 *
 * `reason` is the sentence, and it is the SERVER'S — several are the exact
 * words `POST /tickets` would have raised for the same mistake, so the file and
 * the form can never tell somebody two different things. Never reword one here.
 */
export interface TicketImportReject {
  row: number;
  code: string;
  reason: string;
  /** The column heading, for the rejects table. */
  field?: string | null;
  /** The offending cell, truncated server-side. */
  value?: string | null;
}

/** A category chain the file names that the catalogue does not hold yet. */
export interface CategoryToCreate {
  /** `Electronics › Television › Android TV`. */
  path: string;
  /** Only the levels that are missing — the rest of `path` already exists. */
  newSegments: string[];
  depth: number;
  isLeaf: boolean;
  /**
   * The last level exists but was not marked as the last sub-category, and has
   * nothing under it, so importing ticks that box. The one EDIT the importer
   * makes to something already there, which is why it is reported separately.
   */
  markedLeaf: boolean;
  /**
   * A brand-new MAIN sub-category — the level a technician certifies on.
   * Nobody can be certified on a node that did not exist, so every ticket under
   * it escalates the moment it is raised. The most useful warning on the screen.
   */
  newMainSubcategory: boolean;
  rowCount: number;
}

/** A product the file names that the catalogue does not hold. */
export interface ProductToSubmit {
  categoryPath: string;
  brandName: string;
  name: string;
  serviceTypes: string[];
  rowCount: number;
  /** Always true — a product this importer creates can never arrive priced. */
  awaitingApproval: boolean;
}

/**
 * What an upload would do, or what it did.
 *
 * A dry run writes nothing and returns exactly what the commit would do, so
 * every figure here is the server's own count. Nothing is parsed in the
 * browser — no spreadsheet library ships to the client.
 */
export interface TicketImportReport {
  dryRun: boolean;
  /** Echoed back on the commit so the numbers confirmed describe that file. */
  fileDigest: string;

  rowsRead: number;
  /** What a commit of this file would raise. The commit button's number. */
  willImport: number;
  /** What it did raise. 0 on a dry run. */
  imported: number;
  /** Rows whose Reference is already on a ticket: skipped, never charged. */
  alreadyImported: number;
  rejected: number;
  /** Capped server-side; `rejected` carries the true total. */
  rejects: TicketImportReject[];

  categoriesToCreate: CategoryToCreate[];
  categoriesCreated: number;
  productsToSubmit: ProductToSubmit[];
  productsSubmitted: number;

  creditsPerTicket: number;
  /** Staff only — a company's balance is not its vendor's business. */
  creditsRequired: number | null;
  creditsAvailable: number | null;
  /** Sent to everyone: pressing Import into a 409 is worse than the range. */
  creditsShort: boolean;
  intakePaused: boolean;

  /**
   * The VENDOR's own credit line against this file, in PAISE — what they will
   * owe when these tickets close, summed from each row's stamped price.
   *
   * All four go to EVERYONE, unlike the two company figures above, and the
   * asymmetry is the one `IntakeStatus.reason` explains: a vendor can do nothing
   * about its company's balance with the platform, but its own line is a debt it
   * is expected to settle, and a file refused without the numbers is an
   * instruction to act with no way to know how much.
   */
  vendorCreditRequiredPaise: number;
  vendorCreditAvailablePaise: number;
  vendorCreditShort: boolean;
  /** This vendor's line is already used up — the sibling of `intakePaused`. */
  vendorCreditPaused: boolean;

  slotRequestsQueued: number;
  /** Repeated rows. Reported, never rejected — see the server's note. */
  duplicateRowsInFile: number;
}
