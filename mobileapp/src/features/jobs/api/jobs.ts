import { authedRequest } from '@/lib/api';
import type { Job, JobStatus, SlaType } from '@/types/domain';

/**
 * Job reads — all real.
 *
 *   listPool   → GET /jobs/pool          (masked)
 *   getOffer   → GET /jobs/pool/:id      (masked)
 *   listMine   → GET /jobs/mine?status=  (unlocked, this technician's own)
 *   getJob     → GET /jobs/:id           (unlocked, 404 unless theirs)
 *   listToday  → GET /jobs/today         (unlocked, slots falling today)
 *
 * There is no `mask()` here. Masking is the server's job: the pool endpoint
 * returns a shape that has no `address` or `phone` FIELD at all, and a
 * client-side mask over data the server already sent is a rendering choice a
 * network tab undoes, not a boundary. The unlocked endpoints apply the same
 * rule from the other side — `technician_id` is in their WHERE clause, so a
 * job that is not yours 404s rather than arriving and being hidden.
 */

/** What `GET /jobs/pool` returns per row. Mirrors `JobOfferOut` in the API. */
interface JobOfferDto {
  id: string;
  code: string;
  subcategoryName: string;
  modelName: string;
  serviceType: string;
  city: string;
  pincode: string;
  /**
   * ISO instants, and NULL together when the customer has not picked a time.
   *
   * A job is offered from the moment it is raised now, in parallel with the
   * WhatsApp asking the customer to choose — so "no slot yet" is an ordinary
   * state on the pool, not an impossible one. This comment used to promise both
   * were always present, and every formatter below was written against that:
   * `new Date(null)` is not an error, it is `Invalid Date`, which renders as
   * those two words on the card.
   */
  slotStart: string | null;
  slotEnd: string | null;
  /**
   * When the service level runs out. Always present, and it is what a job with
   * no slot counts down to instead — there is no other deadline on one.
   */
  slaDueAt: string;
  serviceLevelHours: number;
  maskedCustomer: string;
  /**
   * What this job pays, in paise — stamped onto the ticket at intake from the
   * product model, so a repricing never changes what somebody was offered.
   *
   * Not nullable: `product_models` cannot hold an unpriced row, so the ticket
   * column is NOT NULL too. There is no vendor price on this shape and there
   * must never be one — what the vendor is charged is not the technician's
   * business, and the server's job schemas carry no such field.
   */
  payoutPaise: number;
  /**
   * A re-notification bonus, in paise. Null unless a manager funded one after
   * this job escalated for want of anybody taking it.
   *
   * On the MASKED offer deliberately: it is the number that is supposed to
   * change the technician's mind, so it has to be on the card they decide
   * from rather than waiting until they have already accepted.
   */
  bonusPaise: number | null;
}

/** `JobOut`: the offer plus everything that unlocks once the job is ours. */
/** One spec off the product — `RAM` / `8 GB`. */
export interface ProductParameterDto {
  name: string;
  value: string;
}

export interface JobDto extends JobOfferDto {
  customerName: string;
  customerPhone: string;
  address: string;
  state: string;
  /** The ticket's own word — `Assigned`, `In Progress`, `Closed`… */
  status: string;
  description: string | null;
  serialNumber: string;
  /** not_needed | pending | sent | failed */
  feedbackRequestStatus: string;

  /** 1–5, or null. Null is "confirmed without rating", never 0. */
  customerRating: number | null;
  customerFeedback: string | null;
  /** Null while still awaiting them. */
  customerConfirmedAt: string | null;
  /** They answered, and the answer was "not finished". */
  customerRefused: boolean;

  /**
   * Where the customer's address is, when ops picked it off a map at intake.
   *
   * Null for a typed address, and null on every ticket raised before the
   * server had these columns. Null MEANS "verify the live photo by pincode
   * instead" — it is never 0, which is a real point in the Gulf of Guinea.
   */
  latitude?: number | null;
  longitude?: number | null;
  /**
   * Metres the live proof photo may be from that point — this company's rule.
   *
   * Optional because an older API does not send it. Undefined means the same
   * as a null latitude: fall back to the pincode compare. Never default it to
   * a number, or the app would block on a radius the server is not enforcing.
   */
  geoRadiusM?: number;
  /**
   * Whether either location rule is ENFORCED on this job — the vendor's own
   * switch, read live by the server rather than stamped on the ticket.
   *
   * Optional because an older API does not send it, and absent must read as
   * TRUE: this app's whole job here is to refuse a capture the server would
   * refuse, so guessing "off" would let through work the upload then rejects.
   *
   * False does not mean "stop asking for a location". Keep requesting a fix and
   * keep attaching whatever arrives — the server stores it either way, and the
   * distance still lands on the ticket's trail. What stops is the blocking.
   */
  locationCheckEnabled?: boolean;

  /**
   * The product's own specs, as ops recorded them against the model.
   *
   * Optional because an older API does not send them; absent reads the same as
   * "none recorded" and the screen simply omits the block. On the accepted job
   * only — the pool offer deliberately carries as little as it can.
   */
  modelParameters?: ProductParameterDto[];
  /** Prose about the product, if any. Read as a sentence, not a spec. */
  modelNotes?: string | null;
}

/**
 * The server's status vocabulary → the app's.
 *
 * Two different alphabets on purpose. The API speaks the ticket's language,
 * which ops and the console share and which has nine words; the app has five
 * and only cares which SCREEN a job belongs on. Mapping here, once, is what
 * keeps every card and badge from having to know that `AI Review` and
 * `Escalated` both mean "still being worked".
 *
 * Anything unrecognised falls to `upcoming` rather than throwing: a status
 * added server-side should put the job somewhere sensible, not blank the list.
 */
const STATUS_MAP: Record<string, JobStatus> = {
  New: 'pool',
  'Slot Pending': 'pool',
  Assigned: 'upcoming',
  'In Progress': 'inprogress',
  'Awaiting Customer': 'inprogress',
  'AI Review': 'inprogress',
  Escalated: 'inprogress',
  Closed: 'completed',
  'Force-Closed': 'completed',
  Cancelled: 'cancelled',
};

function toJobStatus(status: string): JobStatus {
  return STATUS_MAP[status] ?? 'upcoming';
}

/**
 * One technician's pool is small — their own pincodes, unclaimed, still ahead
 * of them. 100 is the server's ceiling and far past anything real; the list is
 * ordered soonest-first, so if it ever did overflow the jobs that matter are
 * the ones kept.
 */
const POOL_LIMIT = 100;

const IST = 'en-IN';
const TZ = 'Asia/Kolkata';

function timeLabel(iso: string): string {
  return new Date(iso)
    .toLocaleTimeString(IST, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: TZ,
    })
    .toUpperCase();
}

/**
 * What a job with no agreed time says where a slot would go.
 *
 * Not "—" and not blank. The technician is deciding whether to take this, and
 * the honest fact is that a time is coming but has not been chosen yet — an
 * em-dash reads as missing data, which is a reason to distrust the card rather
 * than a reason to accept it.
 *
 * NOT approved copy: the prototype has no slotless job, so there is no approved
 * string for this state. See the note at the head of the pool screen.
 */
export const NO_SLOT_YET = 'Time not set yet';
export const NO_SLOT_SHORT = 'No time yet';

/** `Today · 2:00 PM–4:00 PM`, in IST — the zone the slot was agreed in. */
function slotLabel(startIso: string | null, endIso: string | null): string {
  if (!startIso || !endIso) return NO_SLOT_YET;
  const start = new Date(startIso);
  const today = new Date();
  const sameDay =
    start.toLocaleDateString(IST, { timeZone: TZ }) ===
    today.toLocaleDateString(IST, { timeZone: TZ });
  const day = sameDay
    ? 'Today'
    : start.toLocaleDateString(IST, { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
  return `${day} · ${timeLabel(startIso)}–${timeLabel(endIso)}`;
}

/** `2–4 PM` for dense rows. */
function slotShortLabel(startIso: string | null, endIso: string | null): string {
  if (!startIso || !endIso) return NO_SLOT_SHORT;
  const hour = (iso: string) =>
    new Date(iso).toLocaleTimeString(IST, { hour: 'numeric', hour12: true, timeZone: TZ });
  const [end, suffix] = hour(endIso).split(' ');
  return `${hour(startIso).split(' ')[0]}–${end} ${suffix ?? ''}`.trim();
}

/**
 * Derived here rather than sent, and recomputed on every read.
 *
 * It drives the status badge and the penalty band, so a value cached at fetch
 * time would drift: a job that was "Upcoming" when the list loaded is
 * "Starting soon" twenty minutes later, and the penalty for cancelling it has
 * changed band.
 *
 * NULL for a job with no agreed time, and null rather than a number on purpose.
 * Returning `Infinity` or `0` would let every `<=` comparison downstream keep
 * working while quietly meaning something — "never starting" or "starting now"
 * — that nobody chose. `null` makes each caller decide, and there are only
 * three.
 */
function hoursUntil(iso: string | null): number | null {
  if (!iso) return null;
  return (new Date(iso).getTime() - Date.now()) / 3_600_000;
}

function toJob(dto: JobOfferDto): Job {
  return {
    id: dto.id,
    code: dto.code,
    category: dto.subcategoryName,
    model: dto.modelName,
    // Empty from a POOL offer, which carries no specs on purpose — the offer is
    // a decision about a trip and a fee. `toFullJob` fills them in once the job
    // is the technician's.
    modelParameters: [],
    modelNotes: null,
    serviceType: dto.serviceType,
    area: dto.city,
    pincode: dto.pincode,
    slot: slotLabel(dto.slotStart, dto.slotEnd),
    slotShort: slotShortLabel(dto.slotStart, dto.slotEnd),
    sla: `${dto.serviceLevelHours}h` as SlaType,
    // No distanceLabel: nothing stores the customer's coordinates, so there is
    // nothing to measure. The card omits the segment rather than guessing.
    payoutPaise: dto.payoutPaise,
    bonusPaise: dto.bonusPaise,
    status: 'pool',
    hoursToSlot: hoursUntil(dto.slotStart),
    maskedCustomer: dto.maskedCustomer,
    // A pool offer has no history: nobody has done it, so no customer has
    // passed judgement on it. Stated rather than omitted so the compiler can
    // keep insisting that every mapper answers the question.
    customerRating: null,
    customerFeedback: null,
    customerConfirmedAt: null,
    customerRefused: false,
  };
}

/** The same, once the job is ours and the masked fields have unlocked. */
export function toAcceptedJob(dto: JobDto): Job {
  return {
    ...toJob(dto),
    // The server's word, not an assumption. `toJob` hardcodes 'pool' because
    // everything in the pool is by definition unclaimed; an accepted job may be
    // at any stage, and guessing 'upcoming' here is what would put a completed
    // job back on Home.
    status: toJobStatus(dto.status),
    serverStatus: dto.status,
    feedbackRequestStatus: dto.feedbackRequestStatus,
    customer: dto.customerName,
    phone: dto.customerPhone,
    address: dto.address,
    // The customer's verdict. Only an ACCEPTED job can have one, which is why
    // it is mapped here and not in `toJob` — a pool offer has no history.
    customerRating: dto.customerRating,
    customerFeedback: dto.customerFeedback,
    customerConfirmedAt: dto.customerConfirmedAt,
    customerRefused: dto.customerRefused,
    // Only on an accepted job, like the address itself — the pool masks where
    // the customer lives, and a coordinate pair is that, stated exactly.
    // `?? null` collapses an older API's missing field onto the same "no point"
    // the typed-address case already means.
    latitude: dto.latitude ?? null,
    longitude: dto.longitude ?? null,
    geoRadiusM: dto.geoRadiusM ?? null,
    // Missing reads as ENFORCED, unlike the three above. Their null selects a
    // different rule; this one would switch the gate off, and an old API that
    // simply never mentions it must not do that.
    locationCheckEnabled: dto.locationCheckEnabled ?? true,
    // Blank rather than undefined, so every screen can map over it without a
    // guard. An older API sending nothing reads as "none recorded".
    modelParameters: dto.modelParameters ?? [],
    modelNotes: dto.modelNotes ?? null,
  };
}

export async function listPool(): Promise<Job[]> {
  const rows = await authedRequest<JobOfferDto[]>(`/jobs/pool?limit=${POOL_LIMIT}`);
  return rows.map(toJob);
}

export async function getOffer(id: string): Promise<Job> {
  return toJob(await authedRequest<JobOfferDto>(`/jobs/pool/${id}`));
}

export async function listMine(status: JobStatus | 'all'): Promise<Job[]> {
  const rows = await authedRequest<JobDto[]>(
    `/jobs/mine?status=${status}&limit=${POOL_LIMIT}`,
  );
  return rows.map(toAcceptedJob);
}

export async function getJob(id: string): Promise<Job> {
  return toAcceptedJob(await authedRequest<JobDto>(`/jobs/${id}`));
}

/**
 * Jobs committed for today — drives the Home list.
 *
 * "Today" is decided by the SERVER, in the company's operating timezone. The
 * mock version filtered on `hoursToSlot < 12`, which is a different question
 * and gave a different answer either side of midnight.
 */
export async function listToday(): Promise<Job[]> {
  const rows = await authedRequest<JobDto[]>('/jobs/today');
  return rows.map(toAcceptedJob);
}
