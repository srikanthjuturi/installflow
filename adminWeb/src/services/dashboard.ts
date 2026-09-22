/**
 * Dashboard transport — live FastAPI, not the mock client.
 *
 * Every figure is a `COUNT` the server ran over the caller's own territory, so
 * an Area Manager's dashboard describes their states and a national head's
 * describes the country. Nothing here computes a number; this module only turns
 * the counts into the cards the approved design draws.
 *
 * ## Why the copy lives here
 *
 * The server sends numbers and nothing else — no labels, no routes. Same rule
 * the global search follows in `GlobalSearch/resultTargets.ts`: a backend that
 * knew `/escalations` would be a second place route paths live, and the two
 * would disagree the first time one moved. The approved strings are the
 * console's, so they stay in the console.
 *
 * ## Three figures the server sends so the CARDS can be true
 *
 * `forceCloseHours`, `slotSilenceHours` and `escalationHours` are `company_rules`
 * columns, not constants. The prototype's "No customer response 48h", "Customer
 * silent > 6h" and "Unassigned within 4h" are this company's defaults — a company
 * that moved the window to 24 would have had a card quoting 48 over a count taken
 * at 24. The sweeps already quote the threshold they selected on, for exactly
 * this reason.
 *
 * `escalationHours` is the one that had been left hard-coded, and it is the one
 * that proved the point: the default moved 4 → 1 and both the escalation tile
 * and the attention card went on reading "4h" over a count taken at 1.
 */

import type { DashboardSummary, Ticket } from "@/types";
import { apiGet } from "./http";
import { listTickets } from "./tickets";

/**
 * What the dashboard is narrowed to. Every field is optional and omitting one
 * means "no narrowing on that axis".
 *
 * `stateId` wins over `regionId` on the server — it is the narrower of the two,
 * which is what a cascading picker means when both are set. Dates are IST
 * calendar days (`YYYY-MM-DD`), inclusive at both ends, and bound INTAKE.
 */
export interface DashboardFilters {
  regionId?: string;
  stateId?: string;
  dateFrom?: string;
  dateTo?: string;
}

/** The wire shape of `GET /tickets/summary`. */
interface SummaryWire {
  openTickets: number;
  breaching: number;
  escalated: number;
  aiFlagged: number;
  sla: { ok: number; warn: number; breach: number };
  funnel: {
    slotPending: number;
    active: number;
    closedThisWeek: number;
    /** The window `closedThisWeek` was counted over. Null when a range is set. */
    closedWithinDays: number | null;
  };
  attention: {
    escalations: number;
    aiReview: number;
    awaitingForceClose: number;
    slotNotConfirmed: number;
    forceCloseHours: number;
    slotSilenceHours: number;
    escalationHours: number;
  };
}

/**
 * The four tiles, the SLA bar, the funnel and the attention list.
 *
 * No tile carries a `delta`. A movement chip needs the same count as it stood
 * earlier and nothing records that — there is no snapshot table, and today's
 * rows cannot answer it, because a ticket closed on Tuesday was open on Monday
 * and leaves no trace of having been. The chips are omitted rather than filled
 * with a percentage over no source; `KpiRow` draws the tile without one.
 */
export async function getDashboard(
  filters: DashboardFilters = {}
): Promise<DashboardSummary> {
  const query = new URLSearchParams();
  if (filters.regionId) query.set("regionId", filters.regionId);
  if (filters.stateId) query.set("stateId", filters.stateId);
  if (filters.dateFrom) query.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) query.set("dateTo", filters.dateTo);
  const qs = query.toString();

  const s = await apiGet<SummaryWire>(`/tickets/summary${qs ? `?${qs}` : ""}`);
  const a = s.attention;

  /* Every card opens a list holding exactly what the card counted.
     `extra` is the card's own narrowing; the dashboard's four ride along
     underneath, so a board filtered to Telangana opens a Telangana list. Both
     destinations apply them server-side through the same `narrowed()` the
     figures came from, which is what makes the number and the rows agree. */
  const linkTo = (path: string, extra: Record<string, string> = {}) => {
    const q = new URLSearchParams(query);
    for (const [k, v] of Object.entries(extra)) q.set(k, v);
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
  // With a range picked the server drops its own rolling 7 days, so the tile
  // means "of the work raised in this period, how much is done". Saying "this
  // week" over that number would be the screen describing a window it is not
  // using — see `closed_in_window` in the service.
  const ranged = Boolean(filters.dateFrom || filters.dateTo);

  return {
    kpis: [
      {
        key: "open",
        label: "Open tickets",
        value: String(s.openTickets),
        // Was "in Pune region", which named a region belonging to nobody: the
        // count is whatever the reader's own territory holds, and for an
        // all-India role that is the country. This says what is counted
        // instead, which is true for every reader.
        sub: "not yet closed",
        // `open=true`, not a bare `/tickets`: the board would open on every
        // closed job as well, under a tile whose own subtitle says "not yet
        // closed". The API filters on the same expression the count came from.
        to: linkTo("/tickets", { open: "true" }),
      },
      {
        key: "breach",
        label: "Breaching SLA",
        value: String(s.breaching),
        sub: "need attention",
        // The SAME `_sla_order_case` rank the tile was counted with, so the
        // number and the rows can never rank one ticket two ways. Terminal
        // tickets rank `done`, which is why no "open" filter is needed here.
        to: linkTo("/tickets", { slaState: "breach" }),
      },
      {
        key: "escalation",
        label: "In escalation",
        value: String(s.escalated),
        sub: `within ${a.escalationHours}h of slot`,
        // The queue, on `half=live` — the same reason the Escalations card
        // below carries it: this counts the savable half, and the unfiltered
        // queue also holds the missed pile.
        to: linkTo("/escalations", { half: "live" }),
      },
      /* AI flagged — hidden with the queue. `s.aiFlagged` counts tickets in the
         `AI Review` status and nothing writes it, so the tile could only ever
         read 0 under a heading for a feature that does not exist. The server
         still sends it; `KpiRow` lays out whatever it is given. */
      // {
      //   key: "ai",
      //   label: "AI flagged",
      //   value: String(s.aiFlagged),
      //   sub: "awaiting review",
      // },
    ],
    // Where "View all" and "Open ticket list" go — the board, still carrying
    // whatever this dashboard is narrowed to. A link that widened the scope on
    // the way out would answer a question the reader did not ask.
    ticketsHref: linkTo("/tickets"),
    sla: s.sla,
    slaHrefs: {
      ok: linkTo("/tickets", { slaState: "ok" }),
      warn: linkTo("/tickets", { slaState: "warn" }),
      breach: linkTo("/tickets", { slaState: "breach" }),
    },
    funnel: [
      {
        n: String(s.funnel.slotPending),
        label: "Slot pending",
        to: linkTo("/tickets", { status: "Slot Pending" }),
      },
      {
        n: String(s.funnel.active),
        label: "Assigned / in progress",
        // TWO statuses, which is why `status` takes a set. Linking to
        // `Assigned` alone would open a list holding part of the number above
        // it, and the reader has no way to tell which part is missing.
        to: linkTo("/tickets", { status: "Assigned,In Progress" }),
      },
      {
        n: String(s.funnel.closedThisWeek),
        label: ranged ? "Closed" : "Closed this week",
        // Both ways a job ends up finished, and the window the server actually
        // measured — `closedWithinDays` is null when a date range is in force,
        // because the range (already riding along in `linkTo`) is what bounds
        // the count then. Reading the number off the response rather than
        // writing 7 here is what stops the tile and its list disagreeing if
        // that window ever moves.
        to: linkTo("/tickets", {
          status: "Closed,Force-Closed",
          ...(s.funnel.closedWithinDays
            ? { closedWithinDays: String(s.funnel.closedWithinDays) }
            : {}),
        }),
      },
    ],
    attention: [
      {
        // `half=live` is the whole point: this counts the jobs that can still
        // be saved, and the queue also holds a missed pile that only ever
        // grows. Landing on the unfiltered queue showed seven rows under a
        // card that said two.
        key: "escalations",
        title: "Escalations",
        sub: `Unassigned within ${a.escalationHours}h`,
        count: String(a.escalations),
        to: linkTo("/escalations", { half: "live" }),
        tone: "danger",
      },
      /* AI verification — hidden with the queue it opens (see `nav.ts`). A
         card is a link, so leaving it would land the reader on the 404 page.
         `attention.aiReview` still arrives on the wire and is still counted
         server-side; nothing on the board reads it while this is commented. */
      // {
      //   key: "ai",
      //   title: "AI verification",
      //   sub: "Flagged serial / image",
      //   count: String(a.aiReview),
      //   to: "/ai-review",
      //   tone: "ai",
      // },
      {
        // `attention`, not a status. The count is two populations — done work
        // the customer never confirmed, and tickets whose window shut with no
        // time picked — and the second is in no single status at all. This
        // linked to `status=Awaiting Customer`, which missed that half and let
        // in every awaiting ticket still inside its window. The API filters on
        // the expression the count ran (`service.awaiting_force_close`).
        key: "force-close",
        title: "Awaiting force-close",
        sub: `No customer response ${a.forceCloseHours}h`,
        count: String(a.awaitingForceClose),
        to: linkTo("/tickets", { attention: "force-close" }),
        tone: "warn",
      },
      {
        // Same fix. The count is "no time yet, asked past the window", in any
        // status a time can still be picked in — so it linked to
        // `status=Slot Pending` and could open an empty list under a full card
        // — the funnel's "Slot pending" beside it reading 0 said as much.
        key: "slot",
        title: "Slot not confirmed",
        sub: `Customer silent > ${a.slotSilenceHours}h`,
        count: String(a.slotNotConfirmed),
        to: linkTo("/tickets", { attention: "slot-unconfirmed" }),
        tone: "info",
      },
    ],
  };
}

/** How many tickets the dashboard peek shows. */
const RECENT_LIMIT = 6;

/**
 * The six most recent tickets, newest intake first.
 *
 * A peek, not a list: the server caps it at six and the table has no paging,
 * so this hands back rows rather than a `Page` nobody would page through.
 *
 * Sorted by creation rather than the list's SLA urgency, because "recent" is
 * the promise the card makes. The tiles above it now come from the same
 * database in the same request cycle, so the two no longer disagree.
 */
export function getRecentTickets(
  filters: DashboardFilters = {}
): Promise<Ticket[]> {
  return listTickets({
    page: 1,
    limit: RECENT_LIMIT,
    sortBy: "createdAt",
    sortDir: "desc",
    // The SAME narrowing as the tiles. Without it the table answers a different
    // question from the figures above it — a dashboard filtered to one region
    // reading zero everywhere, over six rows from another.
    filters: { ...filters },
  }).then((result) => result.rows);
}
