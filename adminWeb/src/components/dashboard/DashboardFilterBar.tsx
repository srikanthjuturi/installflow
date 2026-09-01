import { useMemo } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useGeoRegions, useStates } from "@/hooks/useGeo";
import type { FilterPatch } from "@/pages/dashboard/DashboardPage";
import type { DashboardFilters } from "@/services/dashboard";
import { formatDate } from "@/utils/datetime";

/** The "no narrowing" option. A `Select` cannot hold an empty string value. */
const ALL = "all";

/**
 * What the dashboard is looking at: where, and when.
 *
 * ## The picker only ever offers what the reader may already see
 *
 * Both lists come from `/geo/*?mine=true`, so a national head gets All India,
 * every region and every state; a regional head gets his regions and the states
 * inside them; an area manager gets his own states. That is presentation, not
 * security — the server ANDs whatever arrives with the caller's own scope, so
 * naming somewhere else reads zero rather than that place's real numbers. The
 * narrowing here exists so nobody is offered a menu whose every option returns
 * nothing.
 *
 * A reader with exactly one region and one state still gets the controls, and
 * they are correct but inert. Hiding them would make the dashboard's shape
 * depend on the viewer's rank, and an area manager comparing notes with his
 * regional head would be looking at a different screen.
 *
 * ## State cascades from region, and clearing region clears state
 *
 * Picking a region narrows the state list to that region. Picking a state while
 * a region is set is the narrower answer and the server treats it that way.
 * Changing the region drops the state, because a state from the old region is
 * not in the new one and leaving it would show an empty dashboard with two
 * controls that each look reasonable on their own.
 *
 * ## The state picker is a combobox; the region picker is not
 *
 * Thirty-six states is past the point where scanning a menu beats typing three
 * letters, and an all-India role sees all of them. Five regions is not — a
 * search box over a list you can read at a glance is a keystroke tax. Both are
 * whole lists held in memory, so the combobox filters locally and never asks
 * the server; its built-in Clear is what "all states" means, which is why there
 * is no sentinel row for it the way the region select needs one.
 *
 * ## Dates are native inputs, deliberately
 *
 * Same control the escalation queue uses. `min`/`max` cross-bind the pair so a
 * range ending before it starts cannot be expressed — a filter that can be set
 * to return nothing by construction is one that will be, and then the empty
 * screen looks like a bug in the data.
 */
export function DashboardFilterBar({
  filters,
  onChange,
}: {
  filters: DashboardFilters;
  /** Sends only what changed — see `setFilters` in `DashboardPage`. */
  onChange: (patch: FilterPatch) => void;
}) {
  const regions = useGeoRegions(true);
  const states = useStates(true);

  const stateOptions = useMemo<ComboboxOption[]>(() => {
    const rows = filters.regionId
      ? (states.data ?? []).filter((s) => s.regionId === filters.regionId)
      : (states.data ?? []);
    // The region is named as a hint only when the list spans several — with a
    // region picked it is the same word on every row, which is noise.
    return rows.map((s) => ({
      value: s.id,
      label: s.name,
      hint: filters.regionId ? undefined : s.regionName,
    }));
  }, [states.data, filters.regionId]);

  const stateValue =
    stateOptions.find((o) => o.value === filters.stateId) ?? null;

  /* What this dashboard is about, in words.
     Every figure on the screen is a count over some territory and some span of
     time, and a reader who arrives at a link — or comes back to a tab they left
     narrowed — has no other way to know which. The controls beside it say the
     same thing, but only if you read three of them and know what "All states"
     under "South" means. This says it once. */
  const where =
    (filters.stateId
      ? states.data?.find((s) => s.id === filters.stateId)?.name
      : filters.regionId
        ? regions.data?.find((r) => r.id === filters.regionId)?.name
        : undefined) ?? "All India";
  const when =
    filters.dateFrom && filters.dateTo
      ? `raised ${formatDate(filters.dateFrom)} – ${formatDate(filters.dateTo)}`
      : filters.dateFrom
        ? `raised since ${formatDate(filters.dateFrom)}`
        : filters.dateTo
          ? `raised up to ${formatDate(filters.dateTo)}`
          : null;

  const dirty = Boolean(
    filters.regionId || filters.stateId || filters.dateFrom || filters.dateTo
  );

  // `h-8` to sit level with the two pickers, which render 32px however tall
  // their trigger class asks to be. A date input is the only control here that
  // does not get its height from the design system, so it is the one that has
  // to be told.
  const field =
    "h-8 rounded-lg border border-input bg-transparent px-2.5 text-[13px] text-ink outline-none focus-visible:border-ring";

  return (
    // Scope on the left, controls on the right: what you are looking at, then
    // what changes it. Wrapping keeps both readable on a narrow window.
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
      <p className="text-[13px] text-ink-2">
        <span className="font-semibold text-ink">{where}</span>
        {when ? <span className="text-ink-3"> · {when}</span> : null}
      </p>

      <div className="flex flex-wrap items-center justify-end gap-2.5">
      <Select
        value={filters.regionId ?? ALL}
        onValueChange={(v) =>
          onChange({
            regionId: v && v !== ALL ? v : undefined,
            // Named explicitly so it is cleared, not merely left alone: the old
            // state almost certainly sits outside the new region.
            stateId: undefined,
          })
        }
      >
        <SelectTrigger className="w-52" aria-label="Filter by region">
          {/* Name the dimension, not just the value — a select reading "All"
              on its own says nothing about what it filters. */}
          <SelectValue>
            {filters.regionId ? (
              <span>
                <span className="text-ink-3">Region: </span>
                {regions.data?.find((r) => r.id === filters.regionId)?.name ??
                  "…"}
              </span>
            ) : (
              <span className="text-ink-3">All India</span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All India</SelectItem>
          {(regions.data ?? []).map((r) => (
            <SelectItem key={r.id} value={r.id}>
              {r.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Combobox
        id="dashboard-state"
        aria-label="Filter by state"
        className="w-56"
        value={stateValue}
        // Cleared means every state — the same thing an unset filter means, so
        // it maps to `undefined` rather than to a sentinel the server would
        // have to know about.
        onValueChange={(option) =>
          onChange({ stateId: option?.value ?? undefined })
        }
        options={stateOptions}
        loading={states.isPending}
        placeholder="All states"
        emptyMessage="No state matches that"
      />

      <div className="flex items-center gap-1.5 text-[13px] text-ink-2">
        {/* "Raised" names the date being filtered. Every count on this screen is
            "of the tickets RAISED in this window", and a bare calendar next to a
            tile called "Open tickets" would leave a reader to guess whether it
            meant intake or the appointment. */}
        <span className="whitespace-nowrap">Raised</span>
        <input
          type="date"
          value={filters.dateFrom ?? ""}
          max={filters.dateTo || undefined}
          onChange={(e) => onChange({ dateFrom: e.target.value || undefined })}
          aria-label="Raised date from"
          className={field}
        />
        <span aria-hidden>–</span>
        <input
          type="date"
          value={filters.dateTo ?? ""}
          min={filters.dateFrom || undefined}
          onChange={(e) => onChange({ dateTo: e.target.value || undefined })}
          aria-label="Raised date to"
          className={field}
        />
      </div>

        {/* Only once something is set. A permanently visible Reset invites a
            click that does nothing and reads as a dead control. */}
        {dirty ? (
          <Button
            variant="ghost"
            size="sm"
            // Every key named, because an empty patch would change nothing.
            onClick={() =>
              onChange({
                regionId: undefined,
                stateId: undefined,
                dateFrom: undefined,
                dateTo: undefined,
              })
            }
          >
            <RotateCcw data-icon="inline-start" />
            Reset
          </Button>
        ) : null}
      </div>
    </div>
  );
}
