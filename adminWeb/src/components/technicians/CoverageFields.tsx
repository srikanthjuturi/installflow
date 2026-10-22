import * as React from "react";
import { FieldGrid } from "@/components/shared/FieldGrid";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { MultiSelect } from "@/components/ui/multi-select";
import { useAutoSelectSingle } from "@/hooks/useAutoSelectSingle";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCoverageOptions } from "@/hooks/useTechnicians";

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
 *
 * Task 09 — its two data sources moved behind `useCoverageOptions(query,
 * regionId)`, which reads the workspace adapter so this markup is shared with
 * the franchise portal unchanged: ops reads the staff territory reads (the
 * region catalogue from `/regions`, pincodes from `/geo/pincodes`), the portal
 * reads the options and pincodes doors of §4.2, its `search` is
 * `/franchise/pincodes`, and `franchisee` — null here — is the subject of its
 * hint copy (§5.9). `boundedByStates` is false there by construction: no
 * portal role covers states.
 */
export function CoverageFields({
  regionId,
  pincodes,
  onRegionId,
  onPincodes,
  regionError,
  pincodeError,
  hasOtherFranchisees,
  className,
}: {
  regionId: string;
  pincodes: string[];
  onRegionId: (next: string) => void;
  onPincodes: (next: string[]) => void;
  regionError?: string;
  pincodeError?: string;
  /**
   * Task 08 — the hint gains a sentence when the company has more than one
   * franchisee: a code another franchisee owns is refused by the server with a
   * 422 `PINCODE_OUTSIDE_FRANCHISEE` naming it. With only the home franchisee
   * there is nothing to collide with, so the sentence would only confuse. The
   * callers pass the option-list length — the same `useFranchiseeOptions`
   * result the list page already holds.
   */
  hasOtherFranchisees?: boolean;
  /** Layout is the caller's business — side by side, stacked, whatever fits. */
  className?: string;
}) {
  const [query, setQuery] = React.useState("");
  // One hook, six answers (§5.4) — this component no longer knows which
  // endpoints stand behind it.
  const {
    regions,
    loadingRegions,
    search,
    boundedByStates,
    ownStates,
    franchisee,
  } = useCoverageOptions(query, regionId);

  // One region on offer is not a choice — fill it in (hard rule 10). It also
  // unblocks the pincode field, which is otherwise waiting on an answer the
  // manager has no way to give.
  useAutoSelectSingle(
    regions.map((r) => r.id),
    regionId,
    onRegionId
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
    <FieldGrid className={className ?? "grid gap-4 sm:grid-cols-2"}>
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
              ? // §5.9 — the portal's empty names the franchisee, since every
                // pincode in this list is already one its franchisee runs; a
                // miss means the code is outside their whole coverage.
                franchisee
                ? `No pincode ${franchisee} runs matches that`
                : "No pincode matches that in this region"
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
                : franchisee
                  ? `Pincodes ${franchisee} runs, in ${regionName}. Search by code or district.`
                  : `Pincodes in ${regionName}. Search by code or district.`}
            {regionId && hasOtherFranchisees
              ? " Pincodes another franchisee owns are refused."
              : null}
          </FieldDescription>
        )}
      </Field>
    </FieldGrid>
  );
}
