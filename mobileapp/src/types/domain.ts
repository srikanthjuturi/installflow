/**
 * Domain model for the technician app.
 *
 * Shapes mirror what the API will eventually return, so binding later is a
 * change of data source, not a change of types.
 */

export type JobStatus = 'pool' | 'upcoming' | 'inprogress' | 'completed' | 'cancelled';
/** The four service levels the API offers. The prototype only ever drew two. */
export type SlaType = '12h' | '24h' | '36h' | '48h';
export type ProofKind = 'barcode' | 'serial' | 'photos' | 'live';
export type VerificationOutcome = 'match' | 'mismatch' | 'unreadable';

/**
 * The six product types the seeded catalogue ships with.
 *
 * Still a literal union because `Job` is mock data and its category is a plain
 * string. A technician's real certifications are `SubcategoryRef[]` from the
 * API — when the jobs slice lands, `Job.category` becomes one too and this
 * union goes with it.
 */
export type ProductCategory =
  | 'Television'
  | 'Washing Machine'
  | 'Refrigerator'
  | 'Air Conditioner'
  | 'Microwave'
  | 'Water Purifier';

/** One thing a technician is certified for, as the API names it. */
export interface SubcategoryRef {
  id: string;
  name: string;
  categoryName: string;
  /** A key from `components/icons/productIcons`. Already resolved by the API. */
  iconKey?: string;
}

/**
 * The signed-in technician, straight off the login response.
 *
 * Its presence on a login response is what says "this account is a technician
 * and onboarding is complete" — the app needs no second call to decide whether
 * to show Home or the registration flow.
 */
export interface TechnicianSession {
  id: string;
  code: string;
  name: string;
  phone: string;
  profileImageUrl: string | null;
  regionName: string;
  /** Display-only, e.g. "Priya Deshmukh · Reliance GreenTech Service". */
  onboardedBy: string;
  subcategories: SubcategoryRef[];
  pincodes: string[];
  /** Null means no limit — the default until they set one. */
  dailyJobCap: number | null;
  /**
   * Jobs already held for TODAY, counted the way the cap is enforced.
   *
   * Not derived from `/jobs/today`: that list drops closed jobs, so it reads
   * lower than the number the server actually refuses on.
   */
  jobsToday: number;
  status: 'active' | 'inactive' | 'suspended';
  /** Null until they have closed a job — a dash, not a zero. */
  rating: number | null;
  jobsCompleted: number;
  onTimePct: number | null;
  /**
   * Whether this technician currently wants work — the Home screen's toggle.
   *
   * The SERVER's answer, not a local default. It used to be neither: the switch
   * lived only in memory, so it silently returned to "online" on every app
   * restart and nothing outside this phone ever knew about it.
   *
   * Note this is intent alone. Whether they are actually *reachable* is
   * observed from the live pool socket and derived server-side; the app never
   * computes that AND itself.
   */
  acceptingWork: boolean;
}

export interface Job {
  /**
   * The ticket's UUID — a route param and an API path segment, never rendered.
   * Mock jobs still use their human code here; both are opaque to routing.
   */
  id: string;
  /**
   * `RGT-INST-0001`. What the cards actually print and what ops quote on the
   * phone. Optional because the mock dataset predates it and uses `id` for
   * both; read it as `job.code ?? job.id`.
   */
  code?: string;
  /**
   * The subcategory's name, as the server spells it — Television, Air
   * Conditioner. A plain string rather than `ProductCategory` since the jobs
   * slice bound: the catalogue is company-scoped data, not a fixed six.
   */
  category: string;
  model: string;
  /**
   * `Installation + Demo` · `Tech Visit` · `Service`.
   *
   * What the technician is actually going to do, which is not always an
   * install — the detail screen used to print "Install & demo" regardless.
   */
  serviceType: string;
  area: string;
  pincode: string;
  /** Human label for the customer-confirmed slot, e.g. 'Today · 2:00–4:00 PM'. */
  slot: string;
  /** Compact form for dense list rows, e.g. '2–4 PM'. */
  slotShort: string;
  /**
   * `12h` / `24h` / `36h` / `48h`. Widened from the two the prototype drew:
   * the server offers four service levels and rendering a 36-hour ticket as
   * one of the other two would be wrong on screen.
   */
  sla: SlaType;
  /**
   * How far the job is. **Optional, and absent on every real job today** —
   * nothing stores a customer's coordinates, so there is nothing to measure
   * from. The card omits the segment rather than printing a guess.
   */
  distanceLabel?: string;
  /**
   * Integer paise. Never a float — format at the edge.
   *
   * **Null on every real job today.** There is no payout column on `tickets`;
   * what a job pays belongs to the ledger, which does not exist yet. Renders
   * as "—", never ₹0 — a zero is a claim about money nobody has made.
   */
  payoutPaise: number | null;
  /**
   * Integer paise, on top of the payout. What a manager attached to this job
   * after nobody took it the first time and it escalated to the Area Service
   * Manager (§7).
   *
   * **Null on almost every job**, and unlike `payoutPaise` that is because
   * most jobs never need one — not because nothing measures it. This is real:
   * `tickets.bonus_paise`, set when a manager funds a re-notification.
   *
   * It arrives on the MASKED offer, before acceptance, which is the whole
   * point. An incentive a technician cannot see on the card they are deciding
   * from incentivises nobody.
   */
  bonusPaise: number | null;
  status: JobStatus;
  /**
   * The server's own status word — `Assigned`, `In Progress`, `Awaiting
   * Customer`, `Closed`…
   *
   * `status` above is the app's five-value vocabulary, which is what badges and
   * list filters want. It is deliberately coarser: `In Progress` and `Awaiting
   * Customer` both map to `inprogress`, because to a badge they are the same
   * thing. To the Job detail CTA they are not — one needs "Complete the job"
   * and the other needs no button at all — so the precise word travels too.
   *
   * Optional because the pool never sends it: everything in the pool is `New`.
   */
  serverStatus?: string;
  /**
   * Whether the customer's confirmation link actually reached them:
   * `not_needed` | `pending` | `sent` | `failed`.
   *
   * The Job detail banner reads this rather than assuming. Telling a technician
   * "the customer has been sent a link" when Meta refused it is the one moment
   * they could still fix it — they are standing in the customer's house.
   */
  feedbackRequestStatus?: string;

  /**
   * What the customer said when they answered the confirmation link.
   *
   * `customerConfirmedAt` is the one that says whether there IS a verdict —
   * a rating of null means "confirmed without rating", which is a different
   * claim from "has not answered yet".
   *
   * REQUIRED, not optional, and nullable instead. Optional let a mapper forget
   * them and still compile: the fields reached the DTO type, the mapping was
   * silently dropped, and the section rendered nothing while the API was
   * returning the data perfectly. A pool offer states them as null, which is
   * true — it has no history — and the compiler now insists somebody says so.
   */
  customerRating: number | null;
  customerFeedback: string | null;
  customerConfirmedAt: string | null;
  /** They answered and said the work is NOT finished. */
  customerRefused: boolean;
  /**
   * Hours until the committed slot; negative means past. Single source for
   * status badges, pool filtering and penalty bands. Becomes a real timestamp
   * at binding time.
   */
  hoursToSlot: number;

  /** Masked until the technician accepts — doc §6. */
  maskedCustomer: string;
  /** Present only once assigned to the current technician. */
  customer?: string;
  address?: string;
  phone?: string;
}

export interface Technician {
  id: string;
  name: string;
  phone: string;
  region: string;
  onboardedBy: string;
  rating: number;
  jobsDone: number;
  onTimePct: number;
  categories: ProductCategory[];
  pincodes: string[];
}



export type TransactionKind = 'install' | 'bonus' | 'penalty';

export interface Transaction {
  id: string;
  kind: TransactionKind;
  title: string;
  subtitle: string;
  /** Signed integer paise: credits positive, penalties negative. */
  amountPaise: number;
}

/** The spans the Earnings screen can be read over. */
export const EARNINGS_PERIODS = ['day', 'week', 'month'] as const;
export type EarningsPeriod = (typeof EARNINGS_PERIODS)[number];

export interface EarningsSummary {
  /**
   * **Null on every real account today, and that is the honest answer.**
   *
   * Net is earned + bonuses − penalties, and `earnedPaise` below has no
   * source — nothing prices an install. With one term unknown the sum is
   * unknown, so this renders "—" rather than a figure.
   *
   * Showing bonuses minus penalties instead would not be a smaller truth: a
   * technician who cancelled once and earned no bonus would see −₹300
   * presented as their week's pay, having done five installs nothing counted.
   */
  netPaise: number | null;
  /**
   * What the JOBS paid. Null until `tickets` has a payout column — the same
   * absence `Job.payoutPaise` has reported since the pool bound.
   */
  earnedPaise: number | null;
  /** Real. Escalation bonuses credited in the period. */
  bonusesPaise: number;
  /** Real, and positive — a magnitude. The screen signs and colours it. */
  penaltiesPaise: number;
}

/** Cancellation penalty, banded by how close to the committed slot it happens. */
export interface PenaltyBand {
  amountPaise: number;
  label: string;
  /** Under 4 hours goes straight to the Area Service Manager — doc §7. */
  escalates: boolean;
}

export const CANCELLATION_REASONS = [
  'Customer not reachable',
  'Wrong / incomplete address',
  'Personal emergency',
  'Vehicle breakdown',
  'Other',
] as const;

export type CancellationReason = (typeof CANCELLATION_REASONS)[number];
