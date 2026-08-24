import { authedRequest } from '@/lib/api';
import { jobs } from '@/mocks/db';
import { delay } from '@/mocks/delay';
import type { Job, JobStatus, SlaType } from '@/types/domain';

/**
 * Job reads.
 *
 * The pool is REAL — `GET /jobs/pool` and `GET /jobs/pool/:id`. The rest are
 * still seams over mock data:
 *   listMine   → GET /jobs/mine?status=
 *   getJob     → GET /jobs/:id           (unlocked)
 *
 * There is no `mask()` here any more. Masking is the server's job: the pool
 * endpoint returns a shape that has no `address` or `phone` FIELD at all, and a
 * client-side mask over data the server already sent is a rendering choice a
 * network tab undoes, not a boundary.
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
}

/** `JobOut`: the offer plus the three fields that unlock on accept. */
export interface JobDto extends JobOfferDto {
  customerName: string;
  customerPhone: string;
  address: string;
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
    area: dto.city,
    pincode: dto.pincode,
    slot: slotLabel(dto.slotStart, dto.slotEnd),
    slotShort: slotShortLabel(dto.slotStart, dto.slotEnd),
    sla: `${dto.serviceLevelHours}h` as SlaType,
    // No distanceLabel: nothing stores the customer's coordinates, so there is
    // nothing to measure. The card omits the segment rather than guessing.
    payoutPaise: dto.payoutPaise,
    status: 'pool',
    hoursToSlot: hoursUntil(dto.slotStart),
    maskedCustomer: dto.maskedCustomer,
  };
}

/** The same, once the job is ours and the three fields have unlocked. */
export function toAcceptedJob(dto: JobDto): Job {
  return {
    ...toJob(dto),
    status: 'upcoming',
    customer: dto.customerName,
    phone: dto.customerPhone,
    address: dto.address,
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
  await delay(`jobs:mine:${status}`);
  const mine = jobs.filter((j) => j.status !== 'pool');
  return status === 'all' ? mine : mine.filter((j) => j.status === status);
}

export async function getJob(id: string): Promise<Job> {
  await delay(`jobs:${id}`);
  const job = jobs.find((j) => j.id === id);
  if (!job) throw new Error(`Job ${id} not found`);
  return job;
}

/** Jobs committed for today — drives the Home list. */
export async function listToday(): Promise<Job[]> {
  await delay('jobs:today');
  return jobs.filter(
    (j) =>
      (j.status === 'upcoming' || j.status === 'inprogress') &&
      j.hoursToSlot >= 0 &&
      j.hoursToSlot < 12,
  );
}
