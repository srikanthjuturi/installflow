import { mockResponse, notFound } from "./client";
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
