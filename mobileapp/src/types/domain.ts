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
   * Where their earnings are paid — a UPI VPA, `name@bank`.
   *
   * Null means they have not given one, which is the normal state for a new
   * technician: neither onboarding mode requires it. Profile → Payout account
   * shows "—" and lets them set it. It costs only the ability to be PAID; the
   * ledger credits them either way.
   */
  upiId: string | null;
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
   * The product's specs, as ops recorded them — panel type, capacity, whatever
   * the catalogue holds. Empty when none were recorded, never undefined.
   *
   * Read LIVE from the product rather than frozen on the job: correcting a spec
   * should fix every job that names the product, because the unit on the wall
   * never changed and the old value was simply wrong. The money and the
   * cancellation rules are the opposite, and ARE frozen.
   */
  modelParameters: { name: string; value: string }[];
  /** Prose about the product, if any. */
  modelNotes: string | null;
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
   * How far the job is. **Optional, and still absent on every real job** —
   * and it stays that way even though `latitude` below now exists.
   *
   * Filling it would need the TECHNICIAN's position on a list screen, which is
   * a different thing from the customer's: it would mean holding a GPS fix
   * while browsing, and the pool must not locate the customer at all. The card
   * omits the segment rather than printing a guess.
   */
  distanceLabel?: string;
  /**
   * Where the customer's address is, on an ACCEPTED job whose address was
   * picked off a map at intake. Null otherwise — including on every pool
   * offer, because a coordinate pair is the address the pool masks.
   *
   * Null is not missing data; it selects the other proof rule. See
   * `features/proof` — with a point the live photo is verified by distance,
   * without one by pincode.
   */
  latitude?: number | null;
  longitude?: number | null;
  /**
   * Metres the live proof photo may be from that point, as this company's
   * Rules configuration sets it. Null when the server did not send one, which
   * means the same as a null latitude: use the pincode rule.
   */
  geoRadiusM?: number | null;
  /**
   * Whether either of those rules is ENFORCED, set per VENDOR by a manager in
   * the console. Absent reads as true — see `features/jobs/api/jobs.ts` for why
   * this one defaults the opposite way to the three fields above it.
   *
   * False does not stop the capture screen asking for a location; it stops it
   * blocking. The photo still carries whatever fix the phone got, because the
   * server still records it and still measures the distance on the trail.
   */
  locationCheckEnabled?: boolean;
  /**
   * Integer paise. Never a float — format at the edge.
   *
   * What this job pays, stamped onto the ticket at intake from the product
   * model — so a repricing next month never changes what somebody was offered.
   *
   * NOT nullable: `product_models` cannot hold an unpriced row, so the ticket
   * column is NOT NULL and "—" is not a state this can reach.
   *
   * There is deliberately no vendor price here. What the vendor is charged is
   * not part of what a technician is shown, and the server's job shapes carry
   * no such field to leak.
   */
  payoutPaise: number;
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
   * status badges, pool filtering and penalty bands.
   *
   * NULL when no time has been agreed — a job can be accepted before the
   * customer picks one. Null rather than a sentinel number: `Infinity` and `0`
   * both keep every comparison compiling while asserting something ("never
   * starting", "starting now") that nobody decided.
   */
  hoursToSlot: number | null;

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



/**
 * `payout` was `install` until installs were priced and the ledger grew a
 * writer for them. Renamed to match the server's `LEDGER_KINDS`, and because a
 * Tech Visit or a Service call pays through the same row without being an
 * install. The ROW'S TITLE still reads "Install · <model>" for an
 * installation — that is the approved prototype's own wording and it comes
 * from the server, which stored it when the money moved.
 */
export type TransactionKind = 'payout' | 'bonus' | 'penalty';

export interface Transaction {
  id: string;
  kind: TransactionKind;
  title: string;
  subtitle: string;
  /** Signed integer paise: credits positive, penalties negative. */
  amountPaise: number;
  /**
   * The job this money is about, when the technician can still open it — null
   * otherwise, and the row is then not a link.
   *
   * Not derivable from `kind`, which is why the server decides it. A penalty
   * is charged for cancelling, and cancelling hands the ticket back to the
   * pool, so the job detail 404s for the person who was charged. A payout's
   * ticket is still theirs. `null` also covers a server that predates the
   * field — the row simply does not navigate.
   */
  ticketId: string | null;
}

/** The NAMED spans the Earnings screen can be read over. */
export const EARNINGS_PERIODS = ['day', 'week', 'month'] as const;
export type EarningsPeriod = (typeof EARNINGS_PERIODS)[number];

/** An inclusive span of IST calendar days, each `YYYY-MM-DD`. See `utils/date`. */
export interface DateRange {
  from: string;
  to: string;
}

/**
 * What the Earnings screen is currently reading over.
 *
 * A union rather than a period plus a nullable range, because those are two
 * fields that can contradict each other and this cannot: the screen is showing
 * a named period or it is showing a span, never something in between.
 */
export type EarningsWindow =
  | { kind: 'period'; period: EarningsPeriod }
  | { kind: 'range'; range: DateRange };

/**
 * The longest span the server will answer for — mirrors `MAX_RANGE_DAYS` in
 * `api/app/core/ledger.py`, which is where the reason lives. Duplicated rather
 * than fetched so the calendar can refuse a longer selection before asking.
 */
export const MAX_RANGE_DAYS = 366;

export interface EarningsSummary {
  /**
   * Earned + bonuses − penalties, in paise.
   *
   * MAY BE NEGATIVE, in a week of heavy cancellation and little work — that is
   * a true thing to say, and `formatPaise` renders the minus. The monthly
   * penalty cap is what stops it running away.
   */
  netPaise: number;
  /** What the JOBS paid — `payout` ledger entries, written at closure. */
  earnedPaise: number;
  /** Real. Escalation bonuses credited in the period. */
  bonusesPaise: number;
  /** Real, and positive — a magnitude. The screen signs and colours it. */
  penaltiesPaise: number;
  /**
   * The span the SERVER says these figures cover, or null from one too old to
   * say.
   *
   * The screen captions a picked range from this rather than from what it
   * asked, which is what stops a build talking to an un-updated API from
   * labelling this week's money with the dates somebody chose. Null means
   * "cannot tell" — the caption then falls back to the request, which is no
   * worse than having never asked.
   */
  covered: DateRange | null;
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
