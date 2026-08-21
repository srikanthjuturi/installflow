import { useMemo, useState } from "react";
import { AlertTriangle, Globe2, Upload } from "lucide-react";
import { PageMeta } from "@/components/shared/PageMeta";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { GeoImportDialog } from "@/components/superadmin/GeoImportDialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useGeoRegions, useStates } from "@/hooks/useGeo";
import type { GeoState } from "@/types/geo";

/**
 * The geography master — region → state → district → pincode, for every
 * company at once. Read-only apart from the import: this is reference data, and
 * hand-editing one state out of 36 while a spreadsheet is the source of truth
 * would be a second, competing way to record the same thing.
 */
export default function GeographyPage() {
  const states = useStates();
  // `/geo/regions`, not the company-side `/regions` — that one is guarded by
  // CompanyPrincipal and 403s for a superadmin, which left this page stuck on
  // its skeleton.
  const regions = useGeoRegions();
  const [importing, setImporting] = useState(false);

  const groups = useMemo(() => {
    if (!regions.data) return [];
    const byRegion = new Map<string, GeoState[]>();
    for (const state of states.data ?? []) {
      const list = byRegion.get(state.regionId);
      if (list) list.push(state);
      else byRegion.set(state.regionId, [state]);
    }
    // Driven by the region catalog, not by the states — a region with nothing
    // in it is exactly what this page needs to show.
    return regions.data.map((region) => ({
      region,
      states: byRegion.get(region.id) ?? [],
    }));
  }, [regions.data, states.data]);

  const empty = !states.isPending && (states.data?.length ?? 0) === 0;

  return (
    <>
      <PageMeta
        title="Geography"
        description="Regions, states, districts and pincodes for every company."
      />

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Geography</h1>
          <p className="text-[13px] text-ink-2">
            One India for every company. Territory is assigned from this — a
            regional head covers regions, an area manager covers states.
          </p>
        </div>
        <Button type="button" className="h-10" onClick={() => setImporting(true)}>
          <Upload data-icon="inline-start" />
          Import from Excel
        </Button>
      </div>

      {states.isError || regions.isError ? (
        <ErrorState
          title="Couldn't load geography"
          error={states.error ?? regions.error}
          onRetry={() => {
            states.refetch();
            regions.refetch();
          }}
        />
      ) : states.isPending || regions.isPending ? (
        <GeographySkeleton />
      ) : empty ? (
        <EmptyState
          icon={Globe2}
          title="No geography loaded yet"
          description="Import a sheet of Region, State, District and Pin Code to get started."
          action={
            <Button type="button" onClick={() => setImporting(true)}>
              <Upload data-icon="inline-start" />
              Import from Excel
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3.5">
          {groups.map(({ region, states: rows }) => (
            <section
              key={region.id}
              className="rounded-lg border border-line bg-surface"
            >
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
                <h2 className="text-[15px] font-semibold text-ink">
                  {region.name}
                </h2>
                <p className="text-[12px] text-ink-3">
                  {rows.length} state{rows.length === 1 ? "" : "s"} ·{" "}
                  {sum(rows, "districtCount").toLocaleString()} districts ·{" "}
                  {sum(rows, "pincodeCount").toLocaleString()} pincodes
                </p>
              </header>

              {rows.length === 0 ? (
                // Not hidden and not an error — a region nobody can usefully be
                // assigned to is information.
                <p className="flex items-center gap-2 px-4 py-3 text-[13px] text-warn">
                  <AlertTriangle className="size-4 shrink-0" aria-hidden />
                  No states. An area manager cannot be assigned here, and a
                  regional head given this region would cover nothing.
                </p>
              ) : (
                <div className="scroll-slim overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <caption className="sr-only">
                      States in {region.name}
                    </caption>
                    <thead className="text-ink-3">
                      <tr className="border-b border-line-2">
                        <th scope="col" className="px-4 py-2 text-left font-medium">
                          State
                        </th>
                        <th scope="col" className="px-4 py-2 text-right font-medium">
                          Districts
                        </th>
                        <th scope="col" className="px-4 py-2 text-right font-medium">
                          Pincodes
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((state) => (
                        <tr
                          key={state.id}
                          className="border-b border-line-2 last:border-0"
                        >
                          <th
                            scope="row"
                            className="px-4 py-2 text-left font-normal text-ink"
                          >
                            {state.name}
                          </th>
                          <td className="px-4 py-2 text-right tabular-nums text-ink-2">
                            {state.districtCount.toLocaleString()}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-ink-2">
                            {state.pincodeCount.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      <GeoImportDialog open={importing} onOpenChange={setImporting} />
    </>
  );
}

function sum(rows: GeoState[], key: "districtCount" | "pincodeCount"): number {
  return rows.reduce((total, row) => total + row[key], 0);
}

/** Matches the real shape — three region cards, so nothing jumps on load. */
function GeographySkeleton() {
  return (
    <div className="grid gap-3.5">
      {Array.from({ length: 3 }).map((_, i) => (
        <section key={i} className="rounded-lg border border-line bg-surface">
          <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-40" />
          </header>
          <div className="grid gap-2 px-4 py-3">
            {Array.from({ length: 4 }).map((__, r) => (
              <Skeleton key={r} className="h-4" style={{ width: `${70 - r * 8}%` }} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
