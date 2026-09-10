import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Globe2, Plus, Search, Upload, X } from "lucide-react";
import { PageMeta } from "@/components/shared/PageMeta";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { GeoDetailPanel, NO_DISTRICT } from "@/components/superadmin/GeoDetailPanel";
import { GeoImportDialog } from "@/components/superadmin/GeoImportDialog";
import { PincodeFormDialog } from "@/components/superadmin/PincodeFormDialog";
import { SwitchOffPincodeDialog } from "@/components/superadmin/SwitchOffPincodeDialog";
import { IndiaMap, type StateMark } from "@/components/geo/IndiaMap";
import { plural } from "@/lib/plural";
import { RegionLegend } from "@/components/geo/RegionLegend";
import { toneFor } from "@/components/geo/regionTone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import {
  useDistricts,
  useGeoRegions,
  useSetPincodeActive,
  useStates,
} from "@/hooks/useGeo";
import type { PincodeFilters } from "@/services/geo";
import type { GeoPincode, GeoState } from "@/types/geo";

/**
 * The geography master — region → state → district → pincode, for every company
 * at once.
 *
 * **Two ways in, because the requirement has two.** A spreadsheet for the whole
 * country, and a form for the one code somebody is stuck on: ticket intake
 * refuses a pincode the master does not hold, and re-uploading 19,496 rows to
 * add one is not a remedy. This screen used to be read-only apart from the
 * import, on the argument that hand-editing beside a spreadsheet would be a
 * second, competing way to record the same thing. What makes it not that is
 * WHERE the writes go: they edit the master rows themselves rather than
 * layering over them, so the sheet still wins the next time it names the same
 * code. `api/app/features/geo/service.py` records exactly which manual edits a
 * re-import reverts.
 *
 * A composer only; every piece of markup lives in `components/superadmin/`.
 *
 * The drill-down lives in the QUERY STRING rather than in component state, so a
 * view of one district is a link somebody can send.
 */
export default function GeographyPage() {
  const [params, setParams] = useSearchParams();
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<GeoPincode | undefined>();
  const [adding, setAdding] = useState(false);
  const [switchingOff, setSwitchingOff] = useState<GeoPincode | undefined>();
  const setActive = useSetPincodeActive();

  const states = useStates();
  // `/geo/regions`, not the company-side `/regions` — that one is guarded by
  // CompanyPrincipal and 403s for a superadmin, which left this page stuck on
  // its skeleton.
  const regions = useGeoRegions();

  const regionId = params.get("region") ?? undefined;
  const stateId = params.get("state") ?? undefined;
  const districtId = params.get("district") ?? undefined;

  const region = regions.data?.find((r) => r.id === regionId);
  const state = states.data?.find((s) => s.id === stateId);
  // Only fetched once a state is chosen — the district catalogue is 754 rows
  // and the top two levels have no use for it.
  const districts = useDistricts({ stateId }, Boolean(stateId));
  const district = districts.data?.find((d) => d.id === districtId);

  /** Replace, not push: drilling is browsing, and twelve clicks should not be
   *  twelve presses of Back to leave the page. */
  const go = (next: { region?: string; state?: string; district?: string }) => {
    const query = new URLSearchParams();
    if (next.region) query.set("region", next.region);
    if (next.state) query.set("state", next.state);
    if (next.district) query.set("district", next.district);
    setParams(query, { replace: true });
    setSearch("");
  };

  /**
   * What the pincode reads are scoped to at this level.
   *
   * `includeInactive` everywhere on this screen, and nowhere else in the
   * console: every other reader of this list is a picker, and offering a code
   * that ticket intake will refuse is worse than not offering it. This is the
   * one screen that can switch one back on, so it has to be able to see it.
   */
  const filters: PincodeFilters = useMemo(() => {
    const base = { includeInactive: true };
    if (districtId === NO_DISTRICT)
      return { ...base, stateId, noDistrict: true };
    if (districtId) return { ...base, districtId };
    if (stateId) return { ...base, stateId };
    if (regionId) return { ...base, regionId };
    return base;
  }, [regionId, stateId, districtId]);

  const scopeLabel =
    districtId === NO_DISTRICT
      ? "no district"
      : (district?.name ?? state?.name ?? region?.name ?? "India");

  const crumbs = [
    { label: "India", onClick: () => go({}) },
    ...(region ? [{ label: region.name, onClick: () => go({ region: region.id }) }] : []),
    ...(state
      ? [
          {
            label: state.name,
            onClick: () => go({ region: state.regionId, state: state.id }),
          },
        ]
      : []),
    ...(districtId
      ? [
          {
            label: districtId === NO_DISTRICT ? "No district" : (district?.name ?? "…"),
            onClick: undefined,
          },
        ]
      : []),
  ];

  const regionCodeById = useMemo(
    () => new Map((regions.data ?? []).map((r) => [r.id, r.code])),
    [regions.data]
  );

  /**
   * Geography colours by REGION — identity, not magnitude and not status.
   *
   * A selected state wins over its region because both live in the URL at once:
   * drilling into Kerala sets `region=South&state=Kerala`, and lighting up all
   * seven southern states there would answer a question nobody asked.
   */
  const markFor = (s: GeoState): StateMark => {
    const chosen = stateId ? s.id === stateId : regionId ? s.regionId === regionId : null;
    const dimmed = chosen === false;
    return {
      fill: toneFor(regionCodeById.get(s.regionId) ?? "").mapFill,
      active: !dimmed,
      // Only outline the chosen set when there IS one — at country level
      // outlining all 36 would be noise, not emphasis.
      marked: chosen === true,
      interactive: true,
      detail: `${s.regionName} · ${plural(s.districtCount, "district")} · ${plural(s.pincodeCount, "pincode")}`,
    };
  };

  const isPending = states.isPending || regions.isPending;
  const isError = states.isError || regions.isError;
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
        <div className="flex flex-wrap items-center gap-2">
          {/* Only once there is geography to add one to. With no states loaded
              the form has nothing to pick, so the empty state below offers the
              import alone — and while loading or failed there is nothing yet
              to add one into either. */}
          {!isPending && !isError && !empty && (
            <Button
              type="button"
              size="toolbar"
              variant="outline"
              onClick={() => setAdding(true)}
            >
              <Plus data-icon="inline-start" />
              Add pincode
            </Button>
          )}
          <Button
            type="button"
            size="toolbar"
            onClick={() => setImporting(true)}
          >
            <Upload data-icon="inline-start" />
            Import from Excel
          </Button>
        </div>
      </div>

      {isError ? (
        <ErrorState
          title="Couldn't load geography"
          error={states.error ?? regions.error}
          onRetry={() => {
            states.refetch();
            regions.refetch();
          }}
        />
      ) : isPending ? (
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
          <StatTiles regions={regions.data} states={states.data} />

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Breadcrumb crumbs={crumbs} />
            <div className="relative ms-auto w-full sm:w-72">
              <Search
                className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3"
                aria-hidden
              />
              <Input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search pincodes in ${scopeLabel}`}
                aria-label={`Search pincodes in ${scopeLabel}`}
                className="ps-8.5"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-3 transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <X className="size-4" aria-hidden />
                </button>
              )}
            </div>
          </div>

          {/* Side by side once there is room for both. The map is ~510px at its
              widest, so anything narrower than xl would squeeze the detail list
              into a column too thin to read — below that they stack. The map
              sticks so it stays on screen while a long district list scrolls.

              The alternative — a viewport-tall page with the detail column
              scrolling inside itself — was tried and reverted: it puts a second
              scrollbar down the middle of the layout, and one page scrollbar
              reads far better than a card that scrolls in place. */}
          <div className="grid items-start gap-3.5 xl:grid-cols-[minmax(0,540px)_minmax(0,1fr)]">
            <div className="xl:sticky xl:top-[calc(var(--spacing-topbar)+0.875rem)]">
              <IndiaMap
                states={states.data}
                heading={state?.name ?? region?.name ?? "India"}
                placeholder="Pick a region or a state"
                selectedStateId={stateId}
                markFor={markFor}
                legend={
                  <RegionLegend
                    regions={regions.data}
                    selectedRegionId={regionId}
                    // `null` clears back to the whole country — the legend
                    // doubles as the region filter, so it has to switch off.
                    onSelect={(id) => go(id ? { region: id } : {})}
                  />
                }
                onSelectState={(s) => go({ region: s.regionId, state: s.id })}
              />
            </div>

            <GeoDetailPanel
              selection={{ regionId, stateId, districtId }}
              regions={regions.data}
              states={states.data}
              search={search}
              scopeLabel={scopeLabel}
              filters={filters}
              onSelectRegion={(id) => go({ region: id })}
              onSelectState={(id) => {
                const next = states.data.find((s) => s.id === id);
                go({ region: next?.regionId, state: id });
              }}
              onSelectDistrict={(id) =>
                go({ region: state?.regionId, state: stateId, district: id })
              }
              onEditPincode={setEditing}
            />
          </div>
        </div>
      )}

      <GeoImportDialog open={importing} onOpenChange={setImporting} />

      {/* Add and edit are the same dialog pointed at different rows, so they are
          two instances rather than one piece of state that means both. A new
          pincode starts wherever the drill-down already is. */}
      {/* Keyed on the drill-down: `defaults` are read once when the form mounts,
          so without this, opening Add from a second district would still be
          pre-filled with the first one's. */}
      <PincodeFormDialog
        key={`add:${stateId ?? ""}:${district?.id ?? ""}`}
        open={adding}
        onOpenChange={setAdding}
        defaults={{ stateId, districtId: district?.id }}
      />
      <PincodeFormDialog
        open={editing !== undefined}
        onOpenChange={(next) => !next && setEditing(undefined)}
        pincode={editing}
        onSwitchOff={(target) => {
          setEditing(undefined);
          setSwitchingOff(target);
        }}
        onSwitchOn={(target) =>
          setActive.mutate(
            { code: target.code, isActive: true },
            {
              onSuccess: () => {
                toast.add({ title: `${target.code} switched back on` });
                setEditing(undefined);
              },
            }
          )
        }
      />
      <SwitchOffPincodeDialog
        open={switchingOff !== undefined}
        onOpenChange={(next) => !next && setSwitchingOff(undefined)}
        pincode={switchingOff}
      />
    </>
  );
}

/* ── pieces ───────────────────────────────────────────────────────────────── */

function Breadcrumb({
  crumbs,
}: {
  crumbs: { label: string; onClick?: () => void }[];
}) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-[13px]">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={crumb.label + i} className="flex items-center gap-1">
              {i > 0 && (
                <span className="text-ink-3" aria-hidden>
                  /
                </span>
              )}
              {last || !crumb.onClick ? (
                <span className="font-semibold text-ink" aria-current="page">
                  {crumb.label}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={crumb.onClick}
                  className="rounded text-ink-2 transition-colors hover:text-ink hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {crumb.label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The four totals. Regions and states are counted from the catalogue; districts
 * and pincodes are SUMMED OVER REGIONS, which is safe — a region's counts come
 * from the server and no pincode belongs to two regions. Summing the districts
 * of one state would not be safe, and the detail panel says why.
 */
function StatTiles({
  regions,
  states,
}: {
  regions: { districtCount: number; pincodeCount: number }[];
  states: unknown[];
}) {
  const districts = regions.reduce((n, r) => n + r.districtCount, 0);
  const pincodes = regions.reduce((n, r) => n + r.pincodeCount, 0);
  const tiles = [
    { label: "Regions", value: regions.length },
    { label: "States", value: states.length },
    { label: "Districts", value: districts },
    { label: "Pincodes", value: pincodes },
  ];
  return (
    <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="rounded-lg border border-line bg-surface px-3.5 py-3"
        >
          <dt className="text-[12px] text-ink-2">{tile.label}</dt>
          <dd className="text-[22px] leading-tight font-semibold tabular-nums text-ink">
            {tile.value.toLocaleString()}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Matches the real shape — tiles, map, panel — so nothing jumps on load. */
function GeographySkeleton() {
  return (
    <div className="grid gap-3.5">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[70px] rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-[420px] rounded-lg" />
      <Skeleton className="h-64 rounded-lg" />
    </div>
  );
}
