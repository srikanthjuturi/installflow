import * as React from "react";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAssignableRegions } from "@/hooks/useCompanyUsers";
import { useStates, useStatesByRegion } from "@/hooks/useGeo";
import { AREA_MANAGER, REGIONAL_HEAD } from "./companyUserSchema";

/**
 * Territory picker, shared by the add and edit dialogs — the role decides what
 * a scope even is, so one component owns all four cases:
 *
 *   national head → all India, nothing to pick
 *   regional head → one or more regions; their states are shown READ-ONLY,
 *                   because he is responsible for all of them and there is no
 *                   choice to make
 *   area manager  → one or more states, picked from the master. His region is
 *                   DERIVED from them and shown back, never chosen
 *   anyone else   → no territory
 *
 * **This is only ever rendered for the person doing the assigning.** Territory
 * is handed down by a senior — a regional head or area manager never sees a
 * picker for their own record.
 *
 * The regions offered are the signed-in user's own (all of them for an
 * all-India role), and states are narrowed to those regions, matching the
 * server rule. Neither is a substitute for it: the server checks both again.
 */
export function ScopeField({
  role,
  regionIds,
  stateIds,
  onRegionIds,
  onStateIds,
  regionError,
  stateError,
}: {
  role: string;
  regionIds: string[];
  stateIds: string[];
  onRegionIds: (next: string[]) => void;
  onStateIds: (next: string[]) => void;
  regionError?: string;
  stateError?: string;
}) {
  const { regions, isLoading, isError } = useAssignableRegions();

  if (role === "national_head") {
    return (
      <Field>
        <FieldLabel htmlFor="scope-national">Territory</FieldLabel>
        {/* Nothing to choose — a national head covers every region. */}
        <Input
          id="scope-national"
          className="sm:max-w-xs"
          value="All India"
          readOnly
          disabled
        />
        <FieldDescription>A national head covers all of India.</FieldDescription>
      </Field>
    );
  }

  if (role === REGIONAL_HEAD) {
    return (
      <RegionalHeadScope
        regionIds={regionIds}
        onRegionIds={onRegionIds}
        regions={regions}
        isLoading={isLoading}
        isError={isError}
        regionError={regionError}
      />
    );
  }

  if (role === AREA_MANAGER) {
    return (
      <AreaManagerScope
        stateIds={stateIds}
        onStateIds={onStateIds}
        regionIds={regions.map((r) => r.id)}
        regionsLoading={isLoading}
        regionsError={isError}
        stateError={stateError}
      />
    );
  }

  return null;
}

/* ---------------------------------------------------------------------- */

function RegionalHeadScope({
  regionIds,
  onRegionIds,
  regions,
  isLoading,
  isError,
  regionError,
}: {
  regionIds: string[];
  onRegionIds: (next: string[]) => void;
  regions: { id: string; name: string }[];
  isLoading: boolean;
  isError: boolean;
  regionError?: string;
}) {
  const options = React.useMemo(
    () => regions.map((r) => ({ value: r.id, label: r.name })),
    [regions]
  );
  const { groups, total, isLoading: statesLoading } =
    useStatesByRegion(regionIds);

  /** While the catalog loads, ids have no names yet — say so, don't guess. */
  const placeholder = isLoading
    ? "Loading regions…"
    : isError
      ? "Couldn't load regions"
      : regions.length
        ? "Type to search regions…"
        : "No regions available";

  return (
    <>
      <Field data-invalid={regionError ? true : undefined}>
        <FieldLabel htmlFor="regionIds" required>
          Regions
        </FieldLabel>
        <MultiSelect
          id="regionIds"
          value={regionIds}
          onValueChange={onRegionIds}
          options={options}
          disabled={isLoading || isError}
          placeholder={placeholder}
          aria-invalid={regionError ? true : undefined}
          aria-describedby={regionError ? "regionIds-error" : undefined}
        />
        {regionError ? (
          <FieldDescription id="regionIds-error" role="alert" className="text-danger">
            {regionError}
          </FieldDescription>
        ) : (
          <FieldDescription>
            A regional head can cover more than one region.
          </FieldDescription>
        )}
      </Field>

      {/* Read-only on purpose. He is responsible for every state in the
          regions above, so this reports the consequence of that choice — it is
          not a second decision, and nothing here is submitted. */}
      {regionIds.length > 0 ? (
        <Field>
          <FieldLabel htmlFor="rh-states">
            States covered
            {total > 0 ? (
              <span className="ml-1 font-normal text-ink-3">({total})</span>
            ) : null}
          </FieldLabel>
          {statesLoading ? (
            <div id="rh-states" className="flex flex-wrap gap-1.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-20 rounded-full" />
              ))}
            </div>
          ) : total === 0 ? (
            <Input
              id="rh-states"
              value="No states in these regions"
              readOnly
              disabled
            />
          ) : (
            <div
              id="rh-states"
              className="grid gap-2 rounded-md border border-line bg-surface-2 px-3 py-2.5"
            >
              {groups.map((group) => (
                <div key={group.regionId}>
                  {groups.length > 1 ? (
                    <p className="mb-1 text-[11px] font-medium text-ink-3">
                      {group.regionName}
                    </p>
                  ) : null}
                  <ul className="flex flex-wrap gap-1.5">
                    {group.states.map((state) => (
                      <li
                        key={state.id}
                        className="rounded-full bg-surface px-2 py-0.5 text-[12px] text-ink-2"
                      >
                        {state.name}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <FieldDescription>
            A regional head is responsible for every state in his regions —
            there is nothing to pick here.
          </FieldDescription>
        </Field>
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------------------- */

function AreaManagerScope({
  stateIds,
  onStateIds,
  regionIds,
  regionsLoading,
  regionsError,
  stateError,
}: {
  stateIds: string[];
  onStateIds: (next: string[]) => void;
  regionIds: string[];
  regionsLoading: boolean;
  regionsError: boolean;
  stateError?: string;
}) {
  const { data, isPending, isError } = useStates();

  // Only states inside the assigner's own regions — the server refuses the
  // rest by name, so offering them would be offering a rejection.
  const assignable = React.useMemo(() => {
    if (!data) return [];
    const mine = new Set(regionIds);
    return data.filter((s) => mine.has(s.regionId));
  }, [data, regionIds]);

  // Built from ALL states, not just the assignable ones, so a chip keeps its
  // name while the catalog loads and for a state outside the assigner's
  // regions — a raw UUID on a chip reads as a bug, not as a restriction.
  const options = React.useMemo(
    () =>
      (data ?? []).map((s) => ({
        value: s.id,
        // The region rides along in the label so two similarly named states in
        // different regions are still distinguishable in the list.
        label: `${s.name} — ${s.regionName}`,
      })),
    [data]
  );

  // What may actually be PICKED is still only the assigner's own regions.
  const selectable = React.useMemo(() => {
    const mine = new Set(assignable.map((s) => s.id));
    return options.filter((o) => mine.has(o.value) || stateIds.includes(o.value));
  }, [assignable, options, stateIds]);

  // What the picked states imply. Shown back because the assigner chose states,
  // not a region, and the region is what the org chart is built on.
  const derivedRegions = React.useMemo(() => {
    const picked = new Set(stateIds);
    const names = assignable
      .filter((s) => picked.has(s.id))
      .map((s) => s.regionName);
    return [...new Set(names)];
  }, [assignable, stateIds]);

  const loading = isPending || regionsLoading;
  const failed = isError || regionsError;
  const placeholder = loading
    ? "Loading states…"
    : failed
      ? "Couldn't load states"
      : assignable.length
        ? "Type to search states…"
        : "No states available";

  return (
    <>
      <Field data-invalid={stateError ? true : undefined}>
        <FieldLabel htmlFor="stateIds" required>
          States
        </FieldLabel>
        <MultiSelect
          id="stateIds"
          value={stateIds}
          onValueChange={onStateIds}
          options={selectable}
          disabled={loading || failed}
          placeholder={placeholder}
          aria-invalid={stateError ? true : undefined}
          aria-describedby={stateError ? "stateIds-error" : undefined}
        />
        {stateError ? (
          <FieldDescription id="stateIds-error" role="alert" className="text-danger">
            {stateError}
          </FieldDescription>
        ) : (
          <FieldDescription>
            He covers every pincode in the states you pick. A state belongs to
            one area manager.
          </FieldDescription>
        )}
      </Field>

      {derivedRegions.length > 0 ? (
        <Field>
          <FieldLabel htmlFor="am-region">Region</FieldLabel>
          {/* Derived, never chosen — see the server's `_set_scope`. Capped
              rather than full width: it holds one or two words, and a
              dialog-wide disabled box reads as a field somebody forgot. */}
          <Input
            id="am-region"
            className="sm:max-w-xs"
            value={derivedRegions.join(", ")}
            readOnly
            disabled
          />
          <FieldDescription>
            Taken from the states above.
          </FieldDescription>
        </Field>
      ) : null}
    </>
  );
}
