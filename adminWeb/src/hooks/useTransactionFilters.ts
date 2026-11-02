import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from "@/types/api";
import {
  DOC_TYPES,
  PARTY_KINDS,
  type DocType,
  type PartyKind,
  type TransactionQuery,
} from "@/types/transaction";
import {
  DEFAULT_PRESET,
  isIsoDay,
  isPreset,
  presetRange,
  type DateRange,
  type PeriodPreset,
} from "@/lib/transactionPeriod";

/**
 * The Transactions screen's whole state, in the query string - a view is a
 * link, the way the ticket board's filters are. Defaults are never written, so
 * a pristine screen stays at a bare `/transactions`.
 *
 *   tab      documents | statement
 *   p        the date preset (omitted = this month)
 *   from/to  the custom range, only with p=custom
 *   type     document type        kind  party kind       party  party id
 *   company  superadmin's company filter
 *   q        search               page, limit
 *   sk, sp   the STATEMENT tab's own party kind and id (a statement needs one
 *            party, which the list's "all parties" cannot express)
 */

export type TransactionTab = "documents" | "statement";

export interface TransactionUrlState {
  tab: TransactionTab;
  preset: PeriodPreset;
  range: DateRange;
  docType?: DocType;
  partyKind?: PartyKind;
  partyId?: string;
  companyId?: string;
  search: string;
  page: number;
  limit: number;
  statementKind?: PartyKind;
  statementParty?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v: string | null) => (v && UUID.test(v) ? v : undefined);
const asPositive = (v: string | null, fallback: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

/** Pure: reads the state out of a query string. Anything unrecognised falls back. */
export function readTransactionState(
  sp: URLSearchParams,
  now: Date = new Date()
): TransactionUrlState {
  const p = sp.get("p");
  let preset: PeriodPreset = isPreset(p) ? p : DEFAULT_PRESET;
  let range = presetRange(preset, now);
  if (preset === "custom") {
    const from = sp.get("from");
    const to = sp.get("to");
    if (isIsoDay(from) && isIsoDay(to)) range = { from, to };
    else preset = DEFAULT_PRESET; // a custom range with no dates is not a range
  }
  if (preset !== "custom") range = presetRange(preset, now);

  const type = sp.get("type");
  const kind = sp.get("kind");
  const sk = sp.get("sk");
  const limit = asPositive(sp.get("limit"), DEFAULT_PAGE_SIZE);
  return {
    tab: sp.get("tab") === "statement" ? "statement" : "documents",
    preset,
    range,
    docType: (DOC_TYPES as readonly string[]).includes(type ?? "")
      ? (type as DocType)
      : undefined,
    partyKind: (PARTY_KINDS as readonly string[]).includes(kind ?? "")
      ? (kind as PartyKind)
      : undefined,
    partyId: asUuid(sp.get("party")),
    companyId: asUuid(sp.get("company")),
    search: sp.get("q")?.trim() ?? "",
    page: asPositive(sp.get("page"), 1),
    limit: PAGE_SIZE_OPTIONS.includes(limit) ? limit : DEFAULT_PAGE_SIZE,
    statementKind: (PARTY_KINDS as readonly string[]).includes(sk ?? "")
      ? (sk as PartyKind)
      : undefined,
    statementParty: asUuid(sp.get("sp")),
  };
}

/** The filters the list and the summary send. */
export function toQuery(s: TransactionUrlState): TransactionQuery {
  return {
    from: s.range.from,
    to: s.range.to,
    docType: s.docType,
    partyKind: s.partyKind,
    partyId: s.partyId,
    companyId: s.companyId,
    search: s.search || undefined,
  };
}

/** A patch: `undefined`/`""` removes a key. */
export type TransactionPatch = Partial<Record<string, string | undefined>>;

/** Keys that do NOT send the list back to page 1. */
const KEEPS_PAGE = new Set(["tab", "limit", "page", "sk", "sp"]);

/** Pure: applies a patch to a query string. */
export function applyTransactionPatch(
  current: URLSearchParams,
  patch: TransactionPatch
): URLSearchParams {
  const next = new URLSearchParams(current);
  let resetsPage = false;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === "") next.delete(key);
    else next.set(key, value);
    if (!KEEPS_PAGE.has(key)) resetsPage = true;
  }
  if (!("page" in patch) && resetsPage) next.delete("page");
  // The defaults are never written.
  if (next.get("p") === DEFAULT_PRESET) next.delete("p");
  if (next.get("p") !== "custom") {
    next.delete("from");
    next.delete("to");
  }
  if (next.get("tab") === "documents") next.delete("tab");
  if (next.get("page") === "1") next.delete("page");
  return next;
}

export function useTransactionFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.toString();
  // `raw` is the dependency, not the object: React Router hands back a new
  // URLSearchParams on every render.
  const state = useMemo(
    () => readTransactionState(new URLSearchParams(raw)),
    [raw]
  );
  const patch = useCallback(
    (changes: TransactionPatch) =>
      setSearchParams((cur) => applyTransactionPatch(cur, changes), {
        replace: true,
      }),
    [setSearchParams]
  );
  return { state, patch, query: useMemo(() => toQuery(state), [state]) };
}
