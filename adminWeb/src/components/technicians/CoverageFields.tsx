import * as React from "react";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { MultiSelect } from "@/components/ui/multi-select";
import { useMe } from "@/hooks/useAuth";
import { useAssignableRegions } from "@/hooks/useCompanyUsers";
import { useAutoSelectSingle } from "@/hooks/useAutoSelectSingle";
import { useInfinitePincodes } from "@/hooks/useGeo";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Where a technician works: a region, and the pincodes inside it.
 *
 * One component because it is one decision, and because every screen that
 * assigns coverage has to get the same three things right:
 *
 *  1. **Region first.** 19,490 pincodes cannot be shipped to a browser, so the
 *     search has to be narrowed before it returns anything useful. Until a
 *     region is chosen the pincode field is disabled and says why.
 *  2. **Pincodes are searched, not typed.** They come from the geography
 *     master, so a typo can no longer create coverage of a place that does not
 *     exist — which is what the old free-text field allowed.
 *  3. **Changing region clears the picks.** They are not in the new region, and
 *     the server would refuse them.
 *
 * Controlled, like `settings/ScopeField` — the caller owns the values and this
 * owns the behaviour, so a form does not have to re-derive any of the above.
 */
export function CoverageFields({
  regionId,
  pincodes,
  onRegionId,
  onPincodes,
  regionError,
  pincodeError,
  className,
}: {
  regionId: string;
  pincodes: string[];
  onRegionId: (next: string) => void;
  onPincodes: (next: string[]) => void;
  regionError?: string;
  pincodeError?: string;
  /** Layout is the caller's business — side by side, stacked, whatever fits. */
  className?: string;
}) {
  const { regions, isLoading: loadingRegions } = useAssignableRegions();
  const { data: me } = useMe();
  const [query, setQuery] = React.useState("");

  // One region on offer is not a choice — fill it in (hard rule 10). It also
  // unblocks the pincode field, which is otherwise waiting on an answer the
  // manager has no way to give.
  useAutoSelectSingle(
    regions.map((r) => r.id),
    regionId,
    onRegionId
  );

  // An area manager covers states, not a whole region, so his search is
  // narrowed to them — offering codes the server will 403 is a picker that
  // invites a refusal. `settings/ScopeField` narrows for the same reason.
  //
  // One state is filterable server-side; several are not (the endpoint takes a
  // single stateId), so the region filter stands and the extra states are
  // dropped client-side. The server remains the authority either way.
  // Memoised: a fresh [] each render would re-key every memo below it.
  const ownStates = React.useMemo(() => me?.states ?? [], [me?.states]);
  const boundedByStates = me?.role === "area_manager" && ownStates.length > 0;
  const singleState =
    boundedByStates && ownStates.length === 1 ? ownStates[0].id : undefined;

  const search = useInfinitePincodes(
    query,
    singleState
      ? { stateId: singleState }
      : { regionId: regionId || undefined },
    Boolean(regionId)
  );

  const stateNames = React.useMemo(
    () => new Set(ownStates.map((s) => s.name)),
    [ownStates]
  );

  const options = React.useMemo(
    () =>
      (boundedByStates
        ? search.rows.filter((p) => stateNames.has(p.stateName))
        : search.rows
      ).map((p) => ({
        value: p.code,
        // The district is what makes a six-digit number recognisable.
        label: p.districts.length ? `${p.code} — ${p.districts[0]}` : p.code,
      })),
    [boundedByStates, search.rows, stateNames]
  );

  const regionName =
    regions.find((r) => r.id === regionId)?.name ?? "this region";

  // A pincode chosen under the old region is not in the new one.
  const previous = React.useRef(regionId);
  React.useEffect(() => {
    if (previous.current && previous.current !== regionId) {
      onPincodes([]);
      setQuery("");
    }
    previous.current = regionId;
  }, [regionId, onPincodes]);

  return (
    <FieldGroup className={className ?? "grid gap-4 sm:grid-cols-2"}>
      <Field data-invalid={regionError ? true : undefined}>
        {/* Both boxes are required in both consumers — the add form and the
            invite — so the mark is unconditional rather than a prop. */}
        <FieldLabel htmlFor="coverage-region" required>
          Region
        </FieldLabel>
        <Select
          value={regionId}
          onValueChange={(v) => onRegionId(v ? String(v) : "")}
          disabled={loadingRegions}
        >
          <SelectTrigger
            id="coverage-region"
            className="w-full"
            aria-invalid={regionError ? true : undefined}
          >
            {/* The value is an id, so map it back to the name — the
                trigger would otherwise show a raw UUID. */}
            <SelectValue placeholder="Select a region">
              {() =>
                regions.find((r) => r.id === regionId)?.name ??
                "Select a region"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {regions.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {regionError ? (
          <FieldDescription role="alert" className="text-danger">
            {regionError}
          </FieldDescription>
        ) : null}
      </Field>

      <Field data-invalid={pincodeError ? true : undefined}>
        <FieldLabel htmlFor="coverage-pincodes" required>
          Service pincodes
        </FieldLabel>
        <MultiSelect
          id="coverage-pincodes"
          value={pincodes}
          onValueChange={onPincodes}
          options={options}
          onSearch={setQuery}
          loading={search.isLoading}
          onLoadMore={search.fetchNextPage}
          hasMore={search.hasNextPage}
          loadingMore={search.isFetchingNextPage}
          disabled={!regionId}
          emptyMessage={
            query
              ? "No pincode matches that in this region"
              : "Type to search pincodes"
          }
          placeholder={
            regionId ? "Search a pincode or a place" : "Choose a region first"
          }
          aria-invalid={pincodeError ? true : undefined}
          aria-describedby={
            pincodeError ? "coverage-pincodes-error" : "coverage-pincodes-hint"
          }
        />
        {pincodeError ? (
          <FieldDescription
            id="coverage-pincodes-error"
            role="alert"
            className="text-danger"
          >
            {pincodeError}
          </FieldDescription>
        ) : (
          <FieldDescription id="coverage-pincodes-hint">
            {!regionId
              ? "Pick a region, then search its pincodes here."
              : boundedByStates
                ? `Pincodes in ${regionName}, inside ${ownStates
                    .map((s) => s.name)
                    .join(", ")}.`
                : `Pincodes in ${regionName}. Search by code or district.`}
          </FieldDescription>
        )}
      </Field>
    </FieldGroup>
  );
}
