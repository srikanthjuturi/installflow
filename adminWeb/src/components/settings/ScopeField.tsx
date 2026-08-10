import * as React from "react";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAssignableRegions } from "@/hooks/useCompanyUsers";
import { AREA_MANAGER, PINCODE_RE, REGIONAL_HEAD } from "./companyUserSchema";

/**
 * Territory picker, shared by the add and edit dialogs — the role decides what
 * a scope even is, so one component owns all four cases:
 *
 *   national head → all India, nothing to pick
 *   regional head → one or more regions
 *   area manager  → one region, then its pincodes
 *   anyone else   → no territory
 *
 * The regions offered are the signed-in user's own (all five for an all-India
 * role), matching the server rule.
 */
export function ScopeField({
  role,
  regionIds,
  pincodes,
  onRegionIds,
  onPincodes,
  regionError,
  pincodeError,
}: {
  role: string;
  regionIds: string[];
  pincodes: string[];
  onRegionIds: (next: string[]) => void;
  onPincodes: (next: string[]) => void;
  regionError?: string;
  pincodeError?: string;
}) {
  const { regions, isLoading, isError } = useAssignableRegions();

  // Stable identity so the combobox's memoised item list doesn't churn.
  const regionOptions = React.useMemo(
    () => regions.map((r) => ({ value: r.id, label: r.name })),
    [regions]
  );

  /** While the catalog loads, ids have no names yet — say so, don't guess. */
  const regionPlaceholder = isLoading
    ? "Loading regions…"
    : isError
      ? "Couldn't load regions"
      : regions.length
        ? "Type to search regions…"
        : "No regions available";

  if (role === "national_head") {
    return (
      <Field>
        <FieldLabel htmlFor="scope-national">Territory</FieldLabel>
        {/* Nothing to choose — a national head covers every region. */}
        <Input id="scope-national" value="All India" readOnly disabled />
        <FieldDescription>A national head covers all of India.</FieldDescription>
      </Field>
    );
  }

  if (role === REGIONAL_HEAD) {
    return (
      <Field data-invalid={regionError ? true : undefined}>
        <FieldLabel htmlFor="regionIds">Regions</FieldLabel>
        <MultiSelect
          id="regionIds"
          value={regionIds}
          onValueChange={onRegionIds}
          options={regionOptions}
          disabled={isLoading || isError}
          placeholder={regionPlaceholder}
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
    );
  }

  if (role === AREA_MANAGER) {
    return (
      <>
        <Field data-invalid={regionError ? true : undefined}>
          <FieldLabel htmlFor="region">Region</FieldLabel>
          <Select
            value={regionIds[0] ?? ""}
            onValueChange={(v) => onRegionIds(v ? [String(v)] : [])}
          >
            <SelectTrigger
              id="region"
              className="w-full"
              aria-invalid={regionError ? true : undefined}
            >
              {/* The value is an id, so map it back to the name — otherwise the
                  trigger shows a raw UUID. */}
              <SelectValue placeholder="Select a region">
                {(v) => regions.find((r) => r.id === v)?.name ?? "Select a region"}
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
          <FieldLabel htmlFor="pincodes">Pincodes</FieldLabel>
          <MultiSelect
            id="pincodes"
            value={pincodes}
            onValueChange={onPincodes}
            allowCustom
            // "560 001" is how people write it; a pasted list separates on commas.
            normalizeCustom={(raw) => raw.replace(/\s+/g, "")}
            validateCustom={(raw) =>
              PINCODE_RE.test(raw) ? null : "Enter a 6-digit pincode"
            }
            placeholder="Type a pincode and press Enter"
            aria-invalid={pincodeError ? true : undefined}
            aria-describedby={pincodeError ? "pincodes-error" : undefined}
          />
          {pincodeError ? (
            <FieldDescription id="pincodes-error" role="alert" className="text-danger">
              {pincodeError}
            </FieldDescription>
          ) : (
            <FieldDescription>
              A pincode belongs to one area manager.
            </FieldDescription>
          )}
        </Field>
      </>
    );
  }

  return null;
}
