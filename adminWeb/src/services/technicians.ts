import {
  ApiError,
  matches,
  mockPage,
  mockResponse,
  notFound,
  sortRows,
} from "./client";
import { JOB_HISTORY, TECHNICIANS } from "./mocks/technicians";
import type { ListParams, Page } from "@/types/api";
import type { Technician } from "@/types";

export interface JobHistoryEntry {
  id: string;
  cat: string;
  date: string;
  outcome: "Closed" | "Cancelled";
}

export interface TechnicianProfile extends Technician {
  history: JobHistoryEntry[];
}

const ALL = "All";

/**
 * The sort keys this endpoint accepts, keyed by DataTable column id — so
 * `sortBy` round-trips: the header the reader clicked is the key the server
 * sorts on, and the arrow the table draws is the order the rows came back in.
 */
const TECH_SORT: Record<string, (t: Technician) => string | number | null> = {
  name: (t) => t.name,
  // How full they are, not the raw cap — 5/5 is busier than 2/6.
  bandwidth: (t) => (t.bwTotal === 0 ? 0 : t.bwUsed / t.bwTotal),
  rating: (t) => t.rating,
  jobs: (t) => t.jobs,
  cancels: (t) => t.cancels,
  status: (t) => t.status,
};

/**
 * Searching, filtering, sorting and slicing all happen HERE, standing in for
 * the backend. The table renders exactly the page it is handed.
 */
export function listTechnicians(
  params: ListParams = {}
): Promise<Page<Technician>> {
  return mockPage(() => {
    const category = params.filters?.category;
    const status = params.filters?.status;

    const rows = TECHNICIANS.filter(
      (t) =>
        (!category || category === ALL || t.cats.includes(category)) &&
        (!status || status === ALL || t.status === status) &&
        matches(t, ["name", "id", "pincodes"], params.search)
    );

    // Ordered by id before sorting: `sortRows` is stable, so an equal-valued
    // tie always lands the same way. Without a total order a background
    // refetch could reorder rows under someone mid-read.
    return sortRows(
      [...rows].sort((a, b) => a.id.localeCompare(b.id)),
      params.sortBy,
      params.sortDir,
      TECH_SORT
    );
  }, params);
}

/**
 * Distinct categories across every technician — the list filter's options.
 *
 * Faceted server-side on purpose: derived from a 20-row page, the filter would
 * only ever offer the categories that happened to be on that page.
 */
export function listTechnicianCategories(): Promise<string[]> {
  return mockResponse(() =>
    [...new Set(TECHNICIANS.flatMap((t) => t.cats))].sort()
  );
}

export interface CreateTechnicianInput {
  name: string;
  phone: string;
  cats: string[];
  pincodes: string[];
  /** Plain jobs-per-day cap, 1–12. */
  bwTotal: number;
  /** Optional cropped profile photo as a data URL. */
  photoUrl?: string;
}

/**
 * Onboarding a technician. Eligibility matches on category + pincode + free
 * bandwidth, so all three are required here — a record missing any of them is
 * never offered a job.
 *
 * The technician starts with nothing behind them: no bandwidth in use, no
 * jobs, no cancellations, no penalty and no bonus, and is Active immediately.
 */
export function createTechnician(
  input: CreateTechnicianInput
): Promise<Technician> {
  return mockResponse(() => {
    if (input.cats.length === 0) {
      throw new ApiError("At least one category is required", 422);
    }
    if (input.pincodes.length === 0) {
      throw new ApiError("At least one service pincode is required", 422);
    }

    const technician: Technician = {
      id: `TCH-${4100 + TECHNICIANS.length}`,
      name: input.name,
      phone: input.phone,
      photoUrl: input.photoUrl,
      cats: input.cats,
      pincodes: input.pincodes.join(", "),
      bwUsed: 0,
      bwTotal: input.bwTotal,
      rating: 0,
      status: "Active",
      jobs: 0,
      cancels: 0,
      penalty: 0,
      bonus: 0,
      joined: new Date().toLocaleDateString("en-IN", {
        month: "short",
        year: "numeric",
      }),
    };
    TECHNICIANS.unshift(technician);
    return technician;
  });
}

export function getTechnician(id: string): Promise<TechnicianProfile> {
  return mockResponse(() => {
    const tech = TECHNICIANS.find((t) => t.id === id);
    if (!tech) notFound("Technician", id);
    return { ...tech, history: JOB_HISTORY };
  });
}

/**
 * Eligible for a given escalated ticket: active, with bandwidth left, and
 * certified for the category. Bandwidth is a plain jobs-per-day count —
 * the "weighted by job type" wording in Rules Config is an open decision.
 *
 * Deliberately NOT paginated. This is the shortlist for one escalated ticket,
 * read inside a card while a manager decides who to hand it to — a page 2 the
 * reader has to go and find would hide candidates at the moment of the choice.
 * It returns the whole eligible set and the table filters it in the browser.
 */
export function listEligibleTechnicians(
  category?: string
): Promise<Technician[]> {
  return mockResponse(() =>
    TECHNICIANS.filter(
      (t) =>
        t.status === "Active" &&
        t.bwUsed < t.bwTotal &&
        (!category || t.cats.includes(category))
    )
  );
}
