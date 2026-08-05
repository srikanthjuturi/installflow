import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import { TICKET_STATUSES, type TicketStatus } from "@/types";

const isStatus = (v: string | null): v is TicketStatus =>
  Boolean(v) && (TICKET_STATUSES as readonly string[]).includes(v as string);

/**
 * Ticket filters live in the query string, not component state — so a
 * filtered view can be pasted into a chat, bookmarked, and survives back.
 */
export function useTicketFilters() {
  const [params, setParams] = useSearchParams();

  const search = params.get("q") ?? "";
  const statusParam = params.get("status");
  const status: TicketStatus | "All" = isStatus(statusParam) ? statusParam : "All";

  const set = useCallback(
    (key: string, value: string, isDefault: boolean) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (isDefault) next.delete(key);
          else next.set(key, value);
          return next;
        },
        // Typing in the search box must not push a history entry per keystroke.
        { replace: true },
      );
    },
    [setParams],
  );

  const setSearch = useCallback((v: string) => set("q", v, v.trim() === ""), [set]);
  const setStatus = useCallback(
    (v: TicketStatus | "All") => set("status", v, v === "All"),
    [set],
  );
  const clear = useCallback(() => setParams({}, { replace: true }), [setParams]);

  const isFiltered = search.trim() !== "" || status !== "All";

  // Stable identity keeps the query key from thrashing on every render.
  const filters = useMemo(() => ({ search, status }), [search, status]);

  return { filters, search, status, setSearch, setStatus, clear, isFiltered };
}
