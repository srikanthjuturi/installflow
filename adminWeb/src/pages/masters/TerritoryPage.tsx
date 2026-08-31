import { useMemo } from "react";
import { useSearchParams } from "react-router";
// Aliased: a bare `Map` import shadows the global Map constructor, and
// `new Map<string, T>()` below then fails to typecheck.
import { Map as MapIcon } from "lucide-react";
import { TerritoryTree, TerritoryTreeSkeleton } from "@/components/masters/TerritoryTree";
import { CoverageLegend } from "@/components/masters/CoverageLegend";
import { TerritoryStatePanel } from "@/components/masters/TerritoryStatePanel";
import { IndiaMap, type StateMark } from "@/components/geo/IndiaMap";
import { LinkButton } from "@/components/shared/LinkButton";
import { PageMeta } from "@/components/shared/PageMeta";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useFeatureAccess } from "@/hooks/useAuth";
import { useStates } from "@/hooks/useGeo";
import { useTerritory } from "@/hooks/useTerritory";
import { plural } from "@/lib/plural";
import type { GeoState } from "@/types/geo";
import type { TerritoryState } from "@/types/territory";

/**
 * Territory mapping — who covers what, drawn on the map.
 *
 * **Read-only, on purpose.** The mapping is made by giving a user regions
 * (Regional Head) or states (Area Manager) on Users & roles, so this page shows
 * the result and links there rather than becoming a second place that records
 * the same thing.
 *
 * Two data sources, joined by state id:
 *
 *   * `/territory` — SCOPED. An all-India role gets every region; a regional
 *     head only their own; an area manager only the STATES assigned to him,
 *     not the rest of the region they sit in — he cannot assign a manager or
 *     reach a technician outside them, so showing them only invited him to
 *     try. So this decides what is visible at all.
 *   * `/geo/states` — the master, all 36. Unscoped because geography is not
 *     tenant data, and the map needs every outline or India stops looking like
 *     India.
 *
 * A state the territory payload does not mention is therefore OUTSIDE the
 * caller's territory. It is still drawn — greyed and inert — because a map
 * missing a third of the country reads as broken, and "not yours" is
 * information rather than an absence.
 */
export default function TerritoryPage() {
  const [params, setParams] = useSearchParams();
  const stateId = params.get("state") ?? undefined;

  // Territory is assigned on Users & roles, so the link there is only worth
  // offering to somebody that screen will let in.
  const canAssign = useFeatureAccess().has("users.view");
  const territory = useTerritory();
  const geo = useStates();

  /** state id -> its coverage, for every state this caller may see. */
  const coverage = useMemo(() => {
    const out = new Map<string, TerritoryState>();
    for (const region of territory.data ?? []) {
      for (const state of region.states) out.set(state.id, state);
    }
    return out;
  }, [territory.data]);

  const counts = useMemo(() => {
    let covered = 0;
    let unassigned = 0;
    for (const state of coverage.values()) {
      if (state.isCovered) covered += 1;
      else unassigned += 1;
    }
    return {
      covered,
      unassigned,
      outside: Math.max(0, (geo.data?.length ?? 0) - coverage.size),
    };
  }, [coverage, geo.data]);

  const markFor = (state: GeoState): StateMark => {
    const own = coverage.get(state.id);

    if (!own) {
      return {
        fill: "fill-chart-empty",
        // Drawn at FULL opacity even though it is not yours. `active: false`
        // renders at 12%, and 12% of an already-pale grey left the northern
        // half of the country invisible — which defeats the reason for drawing
        // it. Full opacity on a neutral reads as "context", and `interactive:
        // false` is what actually makes it inert.
        active: true,
        marked: false,
        interactive: false,
        detail: "Outside your territory",
      };
    }

    const who = own.coveredBy?.name;
    const detail = own.isCovered
      ? // Covered with no name attached is a real state of affairs, not a bug:
        // a regional head is told a state is taken without being shown a
        // manager from a region they do not cover.
        `${state.regionName} · covered${who ? ` by ${who}` : ""} · ${plural(state.pincodeCount, "pincode")}`
      : `${state.regionName} · no area manager · ${plural(state.pincodeCount, "pincode")}`;

    return {
      fill: own.isCovered ? "fill-ok" : "fill-warn",
      active: true,
      // Only the selected state is outlined. There used to be a second reason
      // — marking an area manager's own states among his colleagues' — but the
      // payload no longer carries anybody else's, so every state a caller can
      // see is now theirs and the outline distinguished nothing.
      marked: stateId ? state.id === stateId : false,
      interactive: true,
      detail,
    };
  };

  const selected = stateId ? geo.data?.find((s) => s.id === stateId) : undefined;

  const isPending = territory.isPending || geo.isPending;
  const isError = territory.isError || geo.isError;

  return (
    <>
      <PageMeta
        title="Territory mapping"
        description="Region, Regional Head, Area Manager and the states each covers."
      />

      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2.5">
        <p className="text-[13px] text-ink-2">
          Region → Regional Head → Area Manager → covered states
        </p>
        {/* Only for somebody who can actually assign. An area manager holds
            states but cannot hand them out — `users.view` is not in his
            features — so this used to send him to a screen the router bounces
            him off. A link to a page you cannot open is worse than no link.

            `outline` is built for a CARD or a dialog: its fill is
            `bg-background`, which on a page is the page's own colour, and its
            border sits at 1.11:1 against it — a control with no visible
            boundary. White plus a brand border takes that to 7.72:1 and reads
            as the secondary action it is, without promoting a navigation link
            to a primary button. */}
        {canAssign ? (
          <LinkButton
            to="/settings/users"
            variant="outline"
            className="border-brand-400 bg-surface text-brand-500 hover:bg-brand-100"
          >
            Assign in Users &amp; roles
          </LinkButton>
        ) : null}
      </div>

      {isError ? (
        <ErrorState
          title="Couldn't load territory mapping"
          error={territory.error ?? geo.error}
          onRetry={() => {
            territory.refetch();
            geo.refetch();
          }}
        />
      ) : isPending ? (
        <TerritorySkeleton />
      ) : !territory.data || territory.data.length === 0 ? (
        // Not a benign empty: an unmapped pincode has no area manager, so no
        // technician is eligible and nothing gets notified.
        <EmptyState
          icon={MapIcon}
          title="No territory mapped"
          description="Give a Regional Head their regions and an Area Manager their states before tickets in those areas can be notified."
        />
      ) : (
        <div className="grid items-start gap-3.5 xl:grid-cols-[minmax(0,540px)_minmax(0,1fr)]">
          <div className="xl:sticky xl:top-[calc(var(--spacing-topbar)+0.875rem)]">
            <IndiaMap
              states={geo.data}
              heading={selected?.name ?? "Your territory"}
              placeholder={
                counts.unassigned > 0
                  ? `${plural(counts.unassigned, "state")} with no area manager`
                  : "Every state you cover has a manager"
              }
              selectedStateId={stateId}
              markFor={markFor}
              legend={<CoverageLegend counts={counts} />}
              onSelectState={(s) =>
                setParams(
                  s.id === stateId ? {} : { state: s.id },
                  { replace: true }
                )
              }
            />
          </div>

          {selected ? (
            <TerritoryStatePanel
              state={selected}
              coverage={coverage.get(selected.id)}
              onClear={() => setParams({}, { replace: true })}
            />
          ) : (
            <TerritoryTree regions={territory.data} />
          )}
        </div>
      )}
    </>
  );
}

function TerritorySkeleton() {
  return (
    <div className="grid items-start gap-3.5 xl:grid-cols-[minmax(0,540px)_minmax(0,1fr)]">
      <Skeleton className="h-[560px] rounded-lg" />
      <TerritoryTreeSkeleton />
    </div>
  );
}
