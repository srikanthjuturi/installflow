import { mockResponse } from "./client";
import { listTickets } from "./tickets";
import type { DashboardSummary, Ticket } from "@/types";

const SUMMARY: DashboardSummary = {
  kpis: [
    {
      key: "open",
      label: "Open tickets",
      value: "987",
      sub: "in Pune region",
      delta: "▲ 4.2%",
      good: true,
    },
    {
      key: "breach",
      label: "Breaching SLA",
      value: "147",
      sub: "need attention",
      delta: "▲ 12%",
      good: false,
    },
    {
      key: "escalation",
      label: "In escalation",
      value: "3",
      sub: "within 4h of slot",
      delta: "▲ 1",
      good: false,
    },
    {
      key: "ai",
      label: "AI flagged",
      value: "4",
      sub: "awaiting review",
      delta: "▼ 2",
      good: true,
    },
  ],
  sla: { ok: 612, warn: 228, breach: 147 },
  funnel: [
    { n: "42", label: "Slot pending" },
    { n: "318", label: "Assigned / in progress" },
    { n: "627", label: "Closed this week" },
  ],
  attention: [
    {
      key: "escalations",
      title: "Escalations",
      sub: "Unassigned within 4h",
      count: "3",
      to: "/escalations",
      tone: "danger",
    },
    {
      key: "ai",
      title: "AI verification",
      sub: "Flagged serial / image",
      count: "4",
      to: "/ai-review",
      tone: "ai",
    },
    {
      // The queue, not one ticket. This pointed at `/tickets/INST-240970` —
      // a ticket CODE, from when the list was mock and keyed by them. The
      // route and the API both take a UUID now, so it 422'd on arrival.
      //
      // `Awaiting Customer` is the status `sweep_force_close` reads
      // (`api/app/features/tickets/sweeps.py`); the list can filter on that,
      // but not on the 48h silence, so this lands a superset. Honest, and the
      // rows the manager wants are in it — unlike a link that only errored.
      key: "force-close",
      title: "Awaiting force-close",
      sub: "No customer response 48h",
      count: "2",
      to: "/tickets?status=Awaiting%20Customer",
      tone: "warn",
    },
    {
      key: "slot",
      title: "Slot not confirmed",
      sub: "Customer silent > 6h",
      count: "5",
      to: "/tickets",
      tone: "info",
    },
  ],
};

export function getDashboard(): Promise<DashboardSummary> {
  return mockResponse(() => SUMMARY);
}

/** How many tickets the dashboard peek shows. */
const RECENT_LIMIT = 6;

/**
 * The six most recent tickets, newest intake first.
 *
 * A peek, not a list: the server caps it at six and the table has no paging,
 * so this hands back rows rather than a `Page` nobody would page through.
 */
export function getRecentTickets(): Promise<Ticket[]> {
  // The one part of this screen that is real. Sorted by creation rather than
  // the list's SLA urgency, because "recent" is the promise the card makes.
  //
  // NB the KPI tiles above it are still the hardcoded SUMMARY below, so they
  // will visibly disagree with these rows until they are wired too.
  return listTickets({
    page: 1,
    limit: RECENT_LIMIT,
    sortBy: "createdAt",
    sortDir: "desc",
  }).then((result) => result.rows);
}
