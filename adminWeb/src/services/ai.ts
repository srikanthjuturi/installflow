import { mockPage, mockResponse, notFound, sortRows } from "./client";
import type { ListParams, Page } from "@/types/api";
import type { AiFlag } from "@/types";

/**
 * AI proof verification has exactly three outcomes (§8):
 *
 *   match       → the ticket proceeds straight to closure, no human involved
 *   mismatch /
 *   low conf.   → ASM review — it lands in this queue
 *   unreadable  → the technician retakes on site before leaving
 *
 * Only the second and third ever reach an admin, so every record below is a
 * ticket a human has to rule on.
 */

/* The threshold is shared with Rules configuration — see rulesDefaults.ts.
   Declaring it here as well let the two screens drift. */
export { AI_CONFIDENCE_THRESHOLD } from "./rulesDefaults";

const AIQUEUE: AiFlag[] = [
  {
    id: "RGT-INST-0009",
    customer: "Sameer Bhosale",
    product: 'Reliance GreenTech 55" QLED',
    expectedSerial: "VDC55QLED-2024",
    // Letter O read where a zero was printed — exactly the class of error the
    // serial comparison has to make legible.
    detectedSerial: "VDC55QLED-2O24",
    conf: 0.62,
    flag: "Serial mismatch",
    tech: "Sunil Pawar",
    when: "12m ago",
  },
  {
    id: "RGT-INST-0012",
    customer: "Karan Mehta",
    product: "Electrolux 470L Side-by-Side",
    expectedSerial: "ELX470SBS-A11",
    // The serial is right; the product photo is what the model could not place.
    detectedSerial: "ELX470SBS-A11",
    conf: 0.48,
    flag: "Low product-match confidence",
    tech: "Sunil Pawar",
    when: "28m ago",
  },
  {
    id: "RGT-INST-0007",
    customer: "Latha Menon",
    product: "Sansui 1.5T Inverter Split",
    expectedSerial: "SNS15INV-3300",
    detectedSerial: "—",
    conf: 0.21,
    flag: "Barcode unreadable",
    tech: "Prakash Jadhav",
    when: "44m ago",
  },
  {
    id: "RGT-INST-0006",
    customer: "Gopal Verma",
    product: 'Reliance GreenTech 43" 4K UHD',
    expectedSerial: "VDC43UHD-1180",
    detectedSerial: "VDC43UHD-118O",
    conf: 0.66,
    flag: "Serial mismatch",
    tech: "Vijay Sawant",
    when: "1h ago",
  },
];

const ALL = "All";

/**
 * Sort keys, keyed by DataTable column id so `sortBy` round-trips.
 *
 * `ticket` sorts on the id, which is what the header says. The queue has no
 * time column, so there is nothing to sort recency on — `when` is a relative
 * label ("12m ago"), not an ordering key.
 */
const AI_SORT: Record<string, (a: AiFlag) => string | number | null> = {
  ticket: (a) => a.id,
  conf: (a) => a.conf,
};

export function listAiFlags(params: ListParams = {}): Promise<Page<AiFlag>> {
  return mockPage(() => {
    const flag = params.filters?.flag;
    const rows = AIQUEUE.filter(
      (a) => !flag || flag === ALL || a.flag === flag
    );

    // A total order, so the 10-second refetch this queue runs on can never
    // reshuffle equal-confidence rows under someone about to click Review.
    return sortRows(
      [...rows].sort((a, b) => a.id.localeCompare(b.id)),
      params.sortBy,
      params.sortDir,
      AI_SORT
    );
  }, params);
}

/**
 * The flag reasons actually present in the queue — the filter's options.
 * Faceted server-side: a reason on page 2 must still be selectable from page 1,
 * and a reason the model never returns must not sit in the list offering nothing.
 */
export function listAiFlagReasons(): Promise<string[]> {
  return mockResponse(() => [...new Set(AIQUEUE.map((a) => a.flag))].sort());
}

export function getAiFlag(id: string): Promise<AiFlag> {
  return mockResponse(() => {
    const found = AIQUEUE.find((a) => a.id === id);
    if (!found) notFound("AI review", id);
    return found;
  });
}

/** Manager overrides the flag: the proof is good, the ticket goes to closure. */
export function approveMatch(input: { id: string }): Promise<{ id: string }> {
  return mockResponse(() => {
    const index = AIQUEUE.findIndex((a) => a.id === input.id);
    if (index === -1) notFound("AI review", input.id);
    AIQUEUE.splice(index, 1);
    return input;
  });
}

/**
 * Manager rejects the proof. The technician is sent back on site to retake it —
 * a gallery upload can never satisfy this, capture is live only.
 */
export function rejectAndRetake(input: {
  id: string;
}): Promise<{ id: string }> {
  return mockResponse(() => {
    const index = AIQUEUE.findIndex((a) => a.id === input.id);
    if (index === -1) notFound("AI review", input.id);
    AIQUEUE.splice(index, 1);
    return input;
  });
}
