import { AlertTriangle, ChevronRight, Globe2 } from "lucide-react";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useDistricts, usePincodes } from "@/hooks/useGeo";
import { cn } from "@/lib/utils";
import type { PincodeFilters } from "@/services/geo";
import type { GeoRegion, GeoState } from "@/types/geo";
import { PincodeChips } from "./PincodeChips";
import { isNeutral, toneFor } from "./regionTone";

/** Where the drill-down currently is. `district: "none"` is the pincodes that
 *  belong to no district — see `NO_DISTRICT`. */
export interface GeoSelection {
  regionId?: string;
  stateId?: string;
  districtId?: string;
}

/**
 * The district id that means "the ones with no district at all".
 *
 * Four real pincodes have no district link. Without a way to ask for them they
 * are visible in a state's total and absent from every one of its districts,
 * which reads as a counting bug rather than as the gap in the source data that
 * it is. A sentinel rather than a flag because it travels in the same URL slot.
 */
export const NO_DISTRICT = "none";

interface Props {
  selection: GeoSelection;
  regions: GeoRegion[];
  states: GeoState[];
  search: string;
  scopeLabel: string;
  filters: PincodeFilters;
  onSelectRegion: (regionId: string) => void;
  onSelectState: (stateId: string) => void;
  onSelectDistrict: (districtId: string) => void;
}

/**
 * The half of the page that follows the breadcrumb: regions, then states, then
 * districts, then the pincodes themselves.
 *
 * This is also the table view the map needs in order not to encode anything in
 * colour alone — every figure the cartogram tints is written out here as a
 * number beside a name.
 */
export function GeoDetailPanel({
  selection,
  regions,
  states,
  search,
  scopeLabel,
  filters,
  onSelectRegion,
  onSelectState,
  onSelectDistrict,
}: Props) {
  const { regionId, stateId, districtId } = selection;

  // A search always resolves to pincodes, whatever level it was typed at — it
  // matches a code, a state or a district name, and the answer to all three is
  // "which pincodes". Scoped to wherever the breadcrumb currently is, so the
  // result never silently includes the rest of India.
  if (search.trim()) {
    return (
      <Panel title={`Pincodes matching “${search.trim()}”`} subtitle={`in ${scopeLabel}`}>
        <PincodeChips
          filters={filters}
          search={search.trim()}
          scopeLabel={scopeLabel}
          // Above a state, the district alone does not identify a result —
          // "Bilaspur" matches one in Himachal and one in Chhattisgarh.
          showState={!stateId}
        />
      </Panel>
    );
  }

  if (districtId) return <DistrictLeaf {...{ selection, states, filters, scopeLabel }} />;
  if (stateId) {
    return (
      <StateDistricts
        stateId={stateId}
        states={states}
        onSelectDistrict={onSelectDistrict}
      />
    );
  }
  if (regionId) {
    const region = regions.find((r) => r.id === regionId);
    return (
      <RegionStates
        region={region}
        states={states.filter((s) => s.regionId === regionId)}
        onSelectState={onSelectState}
      />
    );
  }
  return <RegionList regions={regions} onSelectRegion={onSelectRegion} />;
}

/* ── levels ───────────────────────────────────────────────────────────────── */

function RegionList({
  regions,
  onSelectRegion,
}: {
  regions: GeoRegion[];
  onSelectRegion: (id: string) => void;
}) {
  return (
    <Panel title="Regions" subtitle="Territory is assigned from these">
      <ul className="grid gap-2 @2xl:grid-cols-2">
        {regions.map((region) => {
          const tone = toneFor(region.code);
          const empty = region.stateCount === 0;
          return (
            <li key={region.id}>
              <button
                type="button"
                onClick={() => onSelectRegion(region.id)}
                disabled={empty}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border border-line border-l-3 px-3.5 py-3 text-left transition-colors",
                  tone.rule,
                  empty
                    ? "cursor-default bg-surface-2"
                    : "bg-surface hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold text-ink">
                      {region.name}
                    </span>
                    {isNeutral(region.code) && !empty && (
                      <span className="text-[11px] text-ink-3">(no map colour)</span>
                    )}
                  </span>
                  {empty ? (
                    // Not hidden and not an error — a region nobody can usefully
                    // be assigned to is the thing this page exists to surface.
                    <span className="mt-0.5 flex items-start gap-1.5 text-[12px] text-warn">
                      <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                      No states. A regional head given this region would cover
                      nothing.
                    </span>
                  ) : (
                    <span className="mt-0.5 block text-[12px] text-ink-2 tabular-nums">
                      {region.stateCount} states ·{" "}
                      {region.districtCount.toLocaleString()} districts ·{" "}
                      {region.pincodeCount.toLocaleString()} pincodes
                    </span>
                  )}
                </span>
                {!empty && (
                  <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function RegionStates({
  region,
  states,
  onSelectState,
}: {
  region?: GeoRegion;
  states: GeoState[];
  onSelectState: (id: string) => void;
}) {
  if (!region) {
    return (
      <Panel title="Region">
        <EmptyState
          icon={Globe2}
          title="That region is no longer in the master"
          description="It may have been renamed or removed by a later import."
        />
      </Panel>
    );
  }
  return (
    <Panel
      title={`States in ${region.name}`}
      subtitle={`${region.pincodeCount.toLocaleString()} pincodes in ${region.stateCount} states`}
    >
      {states.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title="No states in this region"
          description="An area manager cannot be assigned here until a state is imported into it."
        />
      ) : (
        <RowList
          rows={states.map((state) => ({
            id: state.id,
            name: state.name,
            meta: `${state.districtCount.toLocaleString()} districts · ${state.pincodeCount.toLocaleString()} pincodes`,
          }))}
          onSelect={onSelectState}
        />
      )}
    </Panel>
  );
}

function StateDistricts({
  stateId,
  states,
  onSelectDistrict,
}: {
  stateId: string;
  states: GeoState[];
  onSelectDistrict: (id: string) => void;
}) {
  const state = states.find((s) => s.id === stateId);
  const districts = useDistricts({ stateId });

  if (!state) {
    return (
      <Panel title="State">
        <EmptyState
          icon={Globe2}
          title="That state is no longer in the master"
          description="It may have been renamed or removed by a later import."
        />
      </Panel>
    );
  }

  return (
    <Panel
      title={`Districts in ${state.name}`}
      subtitle={`${state.pincodeCount.toLocaleString()} pincodes · ${state.regionName} region`}
    >
      {districts.isError ? (
        <ErrorState
          title="Couldn't load districts"
          error={districts.error}
          onRetry={() => districts.refetch()}
        />
      ) : districts.isPending ? (
        <div className="grid gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          {/* Both caveats sit ABOVE the list, together. They are two halves of
              "how to read these numbers" — some pincodes are counted twice,
              some are not counted at all — and the second was a 75-row scroll
              away from the first when it lived at the bottom. */}
          <p className="mb-2.5 text-[12px] text-ink-3">
            Districts can share a pincode, so these total more than{" "}
            {state.pincodeCount.toLocaleString()}.
          </p>
          <OrphanNote stateId={stateId} onOpen={() => onSelectDistrict(NO_DISTRICT)} />
          <RowList
            rows={districts.data.map((district) => ({
              id: district.id,
              name: district.name,
              meta: `${district.pincodeCount.toLocaleString()} pincodes`,
            }))}
            onSelect={onSelectDistrict}
          />
        </>
      )}
    </Panel>
  );
}

/**
 * "N pincodes are in no district" — shown only when there are any.
 *
 * It asks the server for the count rather than deriving it, because it cannot
 * be derived: subtracting the district counts from the state total
 * double-counts every pincode that spans two districts.
 */
function OrphanNote({
  stateId,
  onOpen,
}: {
  stateId: string;
  onOpen: () => void;
}) {
  const orphans = useDistrictlessCount(stateId);
  if (!orphans) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mb-2.5 flex w-full items-start gap-2 rounded-lg border border-warn/30 bg-warn-bg px-3.5 py-2.5 text-left text-[12px] transition-colors hover:border-warn/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <AlertTriangle className="mt-px size-4 shrink-0 text-warn" aria-hidden />
      <span className="flex-1 text-ink-2">
        <span className="font-medium text-ink">
          {orphans.toLocaleString()} pincode{orphans === 1 ? "" : "s"} in no
          district.
        </span>{" "}
        The source never named one. They are in the state's total but in none of
        the districts above — open them.
      </span>
      <ChevronRight className="mt-px size-4 shrink-0 text-ink-3" aria-hidden />
    </button>
  );
}

function DistrictLeaf({
  selection,
  states,
  filters,
  scopeLabel,
}: {
  selection: GeoSelection;
  states: GeoState[];
  filters: PincodeFilters;
  scopeLabel: string;
}) {
  const state = states.find((s) => s.id === selection.stateId);
  const orphaned = selection.districtId === NO_DISTRICT;
  return (
    <Panel
      title={orphaned ? "Pincodes in no district" : scopeLabel}
      subtitle={
        orphaned
          ? `In ${state?.name ?? "this state"} — the source named no district for these`
          : state
            ? `${state.name} · ${state.regionName} region`
            : undefined
      }
    >
      <PincodeChips
        filters={filters}
        search=""
        scopeLabel={scopeLabel}
        // Not passed for the orphan view: there is no current district there,
        // and every one of those chips genuinely has nothing to name.
        currentDistrict={orphaned ? undefined : scopeLabel}
      />
    </Panel>
  );
}

/* ── pieces ───────────────────────────────────────────────────────────────── */

function RowList({
  rows,
  onSelect,
}: {
  rows: { id: string; name: string; meta: string }[];
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="grid gap-1.5 @md:grid-cols-2 @3xl:grid-cols-3">
      {rows.map((row) => (
        <li key={row.id}>
          <button
            type="button"
            onClick={() => onSelect(row.id)}
            className="flex w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-ink">
                {row.name}
              </span>
              <span className="block text-[11px] text-ink-2 tabular-nums">
                {row.meta}
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line px-4 py-2.5">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {subtitle && <p className="text-[12px] text-ink-3">{subtitle}</p>}
      </header>
      {/* A container, so the lists below size to THIS column and not to the
          viewport — the panel is half-width beside the map above xl and full
          width below it, and a viewport breakpoint gets one of the two wrong. */}
      <div className="@container p-4">{children}</div>
    </section>
  );
}

/**
 * How many of a state's pincodes sit in no district.
 *
 * One row is fetched purely for its `totalRecords` — the cheapest way to ask a
 * paginated endpoint "how many", and it keeps the number authoritative rather
 * than inferred from arithmetic that a multi-district pincode breaks.
 */
function useDistrictlessCount(stateId: string): number {
  const query = usePincodes({ page: 1, limit: 1 }, { stateId, noDistrict: true });
  return query.data?.pagination.totalRecords ?? 0;
}
