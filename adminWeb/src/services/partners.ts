import { ApiError, mockPage, mockResponse, sortRows } from "./client";
import { FRANCHISES, FREELANCERS } from "./mocks/partners";
import type { ListParams, Page } from "@/types/api";
import type { Partner, PartnerKind, Role } from "@/types";

/**
 * Freelancers and franchises differ only in which list they belong to, so one
 * pair of functions serves both and the kind picks the store. Appointment
 * collects a mobile number and nothing else — see `types/partner.ts`.
 */

const ALL = "All";

const STORE: Record<PartnerKind, Partner[]> = {
  Freelancer: FREELANCERS,
  Franchise: FRANCHISES,
};

/** `FRL-` for freelancers, `FRN-` for franchises — visible in every id. */
const PREFIX: Record<PartnerKind, string> = {
  Freelancer: "FRL-",
  Franchise: "FRN-",
};

const FIRST_ID: Record<PartnerKind, number> = {
  Freelancer: 1001,
  Franchise: 2001,
};

/** The ten digits that identify a number, however it was typed. */
function digitsOf(value: string): string {
  return value.replace(/\D/g, "").slice(-10);
}

/**
 * One stored shape — `+91 98220 11223`. Normalising on the way in is what
 * keeps the column readable and makes "already appointed" mean the same thing
 * whether the number arrived with a +91, a space or neither.
 */
function normalizePhone(value: string): string {
  const digits = digitsOf(value);
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

/**
 * The search box holds a phone number far more often than an id, so digits are
 * matched against digits — "9876543210" has to find `+91 98765 43210`, which a
 * plain substring never would. Anything non-numeric is treated as an id.
 */
function matchesQuery(partner: Partner, query?: string): boolean {
  const q = query?.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, "");
  return digits
    ? digitsOf(partner.phone).includes(digits)
    : partner.id.toLowerCase().includes(q);
}

/** Keyed by DataTable column id, so `sortBy` round-trips. */
const PARTNER_SORT: Record<string, (p: Partner) => string | number | null> = {
  id: (p) => p.id,
  phone: (p) => p.phone,
  status: (p) => p.status,
  appointedBy: (p) => p.appointedBy,
  appointedOn: (p) => p.appointedOn,
};

/**
 * Searching, filtering, sorting and slicing all happen HERE, standing in for
 * the backend. The table renders exactly the page it is handed.
 */
export function listPartners(
  kind: PartnerKind,
  params: ListParams = {}
): Promise<Page<Partner>> {
  return mockPage(() => {
    const status = params.filters?.status;

    const rows = STORE[kind].filter(
      (p) =>
        (!status || status === ALL || p.status === status) &&
        matchesQuery(p, params.search)
    );

    // Ordered by id before sorting: `sortRows` is stable, so an equal-valued
    // tie always lands the same way and a background refetch cannot reorder
    // rows under someone mid-read.
    return sortRows(
      [...rows].sort((a, b) => a.id.localeCompare(b.id)),
      params.sortBy,
      params.sortDir,
      PARTNER_SORT
    );
  }, params);
}

export interface CreatePartnerInput {
  /** The only field appointment collects. */
  phone: string;
  /** The role of the manager doing the appointing. */
  appointedBy: Role;
}

/**
 * Appointing a partner sends an invite to the number, so the record starts as
 * `Invited` and stays that way until registration completes.
 *
 * The same number is rejected twice: two records inviting one phone would race
 * for whichever registration arrived first.
 */
export function createPartner(
  kind: PartnerKind,
  input: CreatePartnerInput
): Promise<Partner> {
  return mockResponse(() => {
    const store = STORE[kind];
    const phone = normalizePhone(input.phone);

    if (store.some((p) => digitsOf(p.phone) === digitsOf(phone))) {
      throw new ApiError(
        `${phone} is already appointed as a ${kind.toLowerCase()}`,
        409
      );
    }

    const partner: Partner = {
      id: `${PREFIX[kind]}${FIRST_ID[kind] + store.length}`,
      kind,
      phone,
      status: "Invited",
      appointedBy: input.appointedBy,
      appointedOn: new Date().toISOString().slice(0, 10),
    };
    store.unshift(partner);
    return partner;
  });
}
