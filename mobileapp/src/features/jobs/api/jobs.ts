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
  /** ISO instants. Both always present — a job with no slot is not offered. */
  slotStart: string;
  slotEnd: string;
  serviceLevelHours: number;
  maskedCustomer: string;
  /** Always null today — there is no payout column. Renders as "—". */
  payoutPaise: number | null;
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

/** `Today · 2:00 PM–4:00 PM`, in IST — the zone the slot was agreed in. */
function slotLabel(startIso: string, endIso: string): string {
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
function slotShortLabel(startIso: string, endIso: string): string {
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
 */
function hoursUntil(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / 3_600_000;
}

function toJob(dto: JobOfferDto): Job {
  return {
    id: dto.id,
    code: dto.code,
    category: dto.subcategoryName,
    model: dto.modelName,
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
