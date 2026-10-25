import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Building2 } from "lucide-react";
import {
  FranchiseePicker,
  FRANCHISEE_PARAM,
} from "@/components/shared/FranchiseePicker";
import { Notice } from "@/components/shared/Notice";
import { PageMeta } from "@/components/shared/PageMeta";
import { LedgerTable } from "@/components/ledger/LedgerTable";
import { LEDGER_KINDS } from "@/components/ledger/ledgerKinds";
import { PoolSummary } from "@/components/ledger/PoolSummary";
import { ReversePenaltyDialog } from "@/components/tickets/ReversePenaltyDialog";
import { toTicketPenalty } from "@/components/franchise/ledgerAdapters";
import { toast } from "@/components/ui/toast";
import { Card, CardContent } from "@/components/ui/card";
import { useFeatureAccess } from "@/hooks/useAuth";
import { useFranchiseeName } from "@/hooks/useTechnicians";
import { useFranchiseeOptions } from "@/hooks/useFranchisees";
import { useLedgerEntries, useLedgerPool, useReversePoolPenalty } from "@/hooks/useLedger";
import { useWorkspace } from "@/hooks/useWorkspace";
import { ALL_FILTER } from "@/hooks/useListParams";
import { DEFAULT_PAGE_SIZE, type ListParams } from "@/types/api";
import type { LedgerEntry } from "@/types";
import { moneyPaise } from "@/utils/money";

/** The query-string key for the Type filter — the control's own name. */
const TYPE_PARAM = "type";
const KINDS: readonly LedgerEntry["kind"][] = LEDGER_KINDS;

export default function LedgerPage() {
  // The Type filter and the §5.10 Franchisee selector both live in the query
  // string, like the ticket board's Status. A filtered ledger is then a link
  // somebody can paste, and "Back to ledger" from a technician or a ticket —
  // which keeps the query string — comes back to the same filtered view rather
  // than the whole ledger.
  const [searchParams, setSearchParams] = useSearchParams();
  const franchiseeParam = searchParams.get(FRANCHISEE_PARAM);

  // Task 09 — the screen runs in two workspaces. The staff console keeps
  // exactly what it had; the portal's pool carries the Reverse button (§4.3),
  // gated on the adapter's key, because the franchisee admin's pool screen
  // never gets the ticket page's one (owner ruling R3).
  const { workspace, features } = useWorkspace();
  const { has } = useFeatureAccess();
  const canReverse =
    features.reversePoolPenalty !== null && has(features.reversePoolPenalty);
  const franchisee = useFranchiseeName();
  const [reversing, setReversing] = useState<LedgerEntry | null>(null);
  const reverse = useReversePoolPenalty();

  // §5.10 — one pool per franchisee (F12). The staff Admin/NH picks whose it
  // is (`franchisees.view` is the key the console already seeds to exactly
  // those two roles); the portal's reader cannot pick — its principal is
  // pinned and its rows are its own, so there is no question to ask.
  const canPick = workspace === "ops" && has("franchisees.view");
  const options = useFranchiseeOptions({ enabled: canPick });

  // The pool a bonus tile and a row BOTH belong to. `null` is home — the
  // server's own default, sent by nobody.
  const pool = useLedgerPool(franchiseeParam);

  // Validated, not trusted: anything but the five kinds means no filter. Sent
  // as it stands, the API would match nothing and the screen would say nothing
  // matches under a dropdown naming a type that does not exist.
  const typeParam = searchParams.get(TYPE_PARAM);
  const kind = KINDS.find((k) => k === typeParam);

  // Newest first — a ledger is read from the most recent transaction back.
  // No `page`: the table loads on scroll, so the cursor lives inside the
  // infinite query rather than in this screen's state.
  const params = useMemo<ListParams>(
    () => ({
      limit: DEFAULT_PAGE_SIZE,
      sortBy: "date",
      sortDir: "desc",
      filters: {
        ...(kind ? { kind } : {}),
        // The stream the rows are read from, named on every request in staff
        // (§5.10). Absent — home — sends nothing, exactly as it always has.
        ...(franchiseeParam ? { [FRANCHISEE_PARAM]: franchiseeParam } : {}),
      },
    }),
    [kind, franchiseeParam]
  );

  // No column sorts and a list that loads on scroll has no page or page size —
  // so the Type filter is what this writes back (the picker writes its own
  // key above). "All" is the dropdown's value for "no filter", NOT a kind, so
  // it removes the key instead of travelling. It used to travel: "Clear
  // filters" (and picking "Type: all") asked the API for kind "all", which
  // matches no rows, and the ledger read "No transactions yet" over a pool
  // full of them.
  const applyParams = (next: ListParams) => {
    const value = next.filters?.kind;
    const url = new URLSearchParams(searchParams);
    if (value && value !== ALL_FILTER) url.set(TYPE_PARAM, value);
    else url.delete(TYPE_PARAM);
    setSearchParams(url, { replace: true });
  };

  // Whose pool is on screen when home is not — for the read-only banner. The
  // option lookup answers before the pool query arrives, and the pool's own
  // `franchiseeName` is beside it as the authoritative restatement once it has.
  const pickedName = !franchiseeParam
    ? null
    : (options.data?.find((o) => o.id === franchiseeParam && !o.isHome)
        ?.name ??
      pool.data?.franchiseeName ??
      null);

  const pickFranchisee = (id: string | null) => {
    const url = new URLSearchParams(searchParams);
    if (id) url.set(FRANCHISEE_PARAM, id);
    else url.delete(FRANCHISEE_PARAM);
    setSearchParams(url, { replace: true });
  };

  const entries = useLedgerEntries(params);
  // Every page loaded so far, in order. The table renders what it is given;
  // the accumulating is the query's job.
  const rows = entries.data?.pages.flatMap((p) => p.rows);
  const meta = entries.data?.pages.at(-1)?.pagination;

  return (
    <>
      {/* §5.9 — the portal's subtitle names its franchisee, the way its every
          other header does; ops keeps the approved description. */}
      <PageMeta
        title="Penalty & bonus pool"
        description={
          workspace === "franchise"
            ? `${franchisee}'s pool`
            : "Cancellation penalties collected and the escalation bonuses they fund."
        }
      />

      {/* §5.10 — the staff selector, in its own card above the tiles like the
          mock draws it, with its one helper line: who may pick and what home
          means. The portal and a non-picker staff session render nothing —
          a control whose every option is the same answer is noise. */}
      {canPick ? (
        <Card className="mb-3.5">
          <CardContent className="flex flex-wrap items-center gap-x-3.5 gap-y-2 py-3">
            <FranchiseePicker
              options={options.data}
              value={franchiseeParam}
              onChange={pickFranchisee}
            />
            <span className="text-xs text-ink-3">
              Admin and National Head only · defaults to home
            </span>
          </CardContent>
        </Card>
      ) : null}

      {/* §5.10 PROPOSED copy, used as given — who works the pool the reader
          is looking at, and what is left for them. Read-only is not silent: a
          screen with no buttons and no word on why reads as broken. */}
      {canPick && pickedName ? (
        <div className="mb-3.5">
          <Notice tone="warn" icon={Building2} title={`Managed by ${pickedName}.`}>
            You can read this pool; its own franchisee admin works it. Rows
            carry no actions.
          </Notice>
        </div>
      ) : null}

      <PoolSummary
        pool={pool.data}
        isLoading={pool.isLoading}
        error={pool.isError ? pool.error : null}
        onRetry={() => pool.refetch()}
      />

      <LedgerTable
        entries={rows}
        fileFranchiseeName={pickedName}
        meta={meta}
        params={params}
        onParams={applyParams}
        isLoading={entries.isLoading}
        // Refetching dims the rows; APPENDING must not. Without the second
        // half, loading page two greys out every row already on screen.
        isFetching={entries.isFetching && !entries.isFetchingNextPage}
        hasNextPage={entries.hasNextPage}
        isFetchingNextPage={entries.isFetchingNextPage}
        fetchNextPage={() => entries.fetchNextPage()}
        readAt={entries.dataUpdatedAt}
        error={entries.isError ? entries.error : null}
        onRetry={() => entries.refetch()}
        // §4.3 — the franchisee admin's pool screen is where a penalty is
        // given back. Ops passes no `onReverse`, so its table draws no
        // Reverse column at all.
        onReverse={
          canReverse
            ? (e) => {
                setReversing(e);
              }
            : undefined
        }
      />

      {/* Outside the loading branch, for the same reason the ticket page's one
          is: closed only on success, and a dialog unmounted mid-flight takes
          its pending state with it. The row is dressed as a `TicketPenalty`
          through the pure adapter — the dialog needs no third shape. */}
      {canReverse ? (
        <ReversePenaltyDialog
          open={reversing !== null}
          onOpenChange={(open) => !open && setReversing(null)}
          penalty={reversing ? toTicketPenalty(reversing) : null}
          isPending={reverse.isPending}
          onConfirm={({ reason }) => {
            if (!reversing) return;
            const entry = reversing;
            reverse.mutate(
              { id: entry.id, reason },
              {
                onSuccess: () => {
                  toast.add({
                    title: "Penalty reversed",
                    // §5.9 — the pool screen's own wording, from the pool.
                    description: `${moneyPaise(entry.amountPaise)} goes back to ${entry.technicianName}.`,
                  });
                  setReversing(null);
                },
              }
            );
          }}
        />
      ) : null}
    </>
  );
}
