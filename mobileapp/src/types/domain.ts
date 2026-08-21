/**
 * Domain model for the technician app.
 *
 * Shapes mirror what the API will eventually return, so binding later is a
 * change of data source, not a change of types.
 */

export type JobStatus = 'pool' | 'upcoming' | 'inprogress' | 'completed' | 'cancelled';
export type SlaType = '24h' | '48h';
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
  /** Display-only, e.g. "Priya Deshmukh · Videocon Service". */
  onboardedBy: string;
  subcategories: SubcategoryRef[];
  pincodes: string[];
  /** Null means no limit — the default until they set one. */
  dailyJobCap: number | null;
  status: 'active' | 'inactive' | 'suspended';
  /** Null until they have closed a job — a dash, not a zero. */
  rating: number | null;
  jobsCompleted: number;
  onTimePct: number | null;
}

export interface Job {
  id: string;
  category: ProductCategory;
  model: string;
  area: string;
  pincode: string;
  /** Human label for the customer-confirmed slot, e.g. 'Today · 2:00–4:00 PM'. */
  slot: string;
  /** Compact form for dense list rows, e.g. '2–4 PM'. */
  slotShort: string;
  sla: SlaType;
  distanceLabel: string;
  /** Integer paise. Never a float — format at the edge. */
  payoutPaise: number;
  status: JobStatus;
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

export type WeekdayKey = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

export interface Availability {
  days: Record<WeekdayKey, boolean>;
  /** Simple jobs-per-day cap, 1–12 — not weighted by job type. */
  bandwidthPerDay: number;
  timeOff: boolean;
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

export interface EarningsSummary {
  netPaise: number;
  earnedPaise: number;
  bonusesPaise: number;
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
