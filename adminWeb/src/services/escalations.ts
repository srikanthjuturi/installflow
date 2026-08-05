import { mockResponse, notFound } from "./client";
import type { Escalation } from "@/types";

/**
 * A ticket lands here when it is still unassigned within 4h of its confirmed
 * slot (§7). The pool is funded by collected cancellation penalties and is
 * what pays the bonus that gets someone to pick it up.
 */
const ESCALATIONS: Escalation[] = [
  {
    id: "INST-240921",
    customer: "Rajesh Nair",
    product: "Kelvinator 7kg Front Load",
    city: "Pimpri",
    pincode: "411018",
    slot: "Aug 5, 09:00–11:00",
    left: "2h 40m",
    reason: "Technician cancelled · no re-accept",
    pool: 1800,
  },
  {
    id: "INST-240940",
    customer: "Vikram Rane",
    product: "Videocon 253L Direct Cool",
    city: "Wakad",
    pincode: "411057",
    slot: "Aug 5, 12:00–14:00",
    left: "3h 15m",
    reason: "Cancelled 2× · unassigned",
    pool: 2400,
  },
  {
    id: "INST-240988",
    customer: "Shalini Rao",
    product: "Sansui 1T Window AC",
    city: "Katraj",
    pincode: "411046",
    slot: "Aug 5, 08:00–10:00",
    left: "1h 05m",
    reason: "No technician accepted",
    pool: 1500,
  },
];

/**
 * Deliberately NOT paginated, unlike the other list endpoints.
 *
 * The queue renders as cards with no paging affordance, and every row is a
 * customer promise counting down. Slicing it server-side would silently hide
 * escalations past the first page — on the one screen where a hidden row is a
 * missed slot. It stays a whole-queue read; if the queue ever grows past a
 * screenful, that is a design decision about the screen, not a page parameter.
 */
export function listEscalations(): Promise<Escalation[]> {
  return mockResponse(() => ESCALATIONS);
}

export function getEscalation(id: string): Promise<Escalation> {
  return mockResponse(() => {
    const found = ESCALATIONS.find((e) => e.id === id);
    if (!found) notFound("Escalation", id);
    return found;
  });
}

/** Re-notifies every eligible technician with a bonus drawn from the pool. */
export function addBonusAndRenotify(input: {
  id: string;
  amount: number;
}): Promise<{ notified: number; amount: number }> {
  return mockResponse(() => {
    const found = ESCALATIONS.find((e) => e.id === input.id);
    if (!found) notFound("Escalation", input.id);
    return { notified: 7, amount: input.amount };
  });
}

/** Last resort when re-notification still finds nobody (§7). */
export function assignTechnician(input: {
  id: string;
  techName: string;
}): Promise<{ id: string; techName: string }> {
  return mockResponse(() => {
    const index = ESCALATIONS.findIndex((e) => e.id === input.id);
    if (index === -1) notFound("Escalation", input.id);
    ESCALATIONS.splice(index, 1);
    return input;
  });
}
