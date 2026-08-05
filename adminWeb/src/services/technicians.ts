import { ApiError, mockResponse, notFound } from "./client";
import { JOB_HISTORY, TECHNICIANS } from "./mocks/technicians";
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

export function listTechnicians(category?: string): Promise<Technician[]> {
  return mockResponse(() =>
    category && category !== "All"
      ? TECHNICIANS.filter((t) => t.cats.includes(category))
      : TECHNICIANS,
  );
}

export interface CreateTechnicianInput {
  name: string;
  phone: string;
  cats: string[];
  pincodes: string[];
  /** Plain jobs-per-day cap, 1–12. */
  bwTotal: number;
}

/**
 * Onboarding a technician. Eligibility matches on category + pincode + free
 * bandwidth, so all three are required here — a record missing any of them is
 * never offered a job.
 *
 * The technician starts with nothing behind them: no bandwidth in use, no
 * jobs, no cancellations, no penalty and no bonus, and is Active immediately.
 */
export function createTechnician(input: CreateTechnicianInput): Promise<Technician> {
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
      joined: new Date().toLocaleDateString("en-IN", { month: "short", year: "numeric" }),
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
 */
export function listEligibleTechnicians(category?: string): Promise<Technician[]> {
  return mockResponse(() =>
    TECHNICIANS.filter(
      (t) =>
        t.status === "Active" &&
        t.bwUsed < t.bwTotal &&
        (!category || t.cats.includes(category)),
    ),
  );
}
