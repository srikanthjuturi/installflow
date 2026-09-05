import * as React from "react";
import { MapPin } from "lucide-react";

import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useInfinitePincodes, usePincodeLookup } from "@/hooks/useGeo";
import { flatten } from "@/lib/placeAddress";
import { cn } from "@/lib/utils";
import { FieldGrid } from "./FieldGrid";
import { useAddressAutocomplete } from "./useAddressAutocomplete";

/**
 * A postal address, everywhere one is asked for.
 *
 * Three forms wanted the same five boxes and each had built them separately —
 * the vendor's registered address, a company's, and the customer address on a
 * ticket. None of them checked the pincode against anything, which on the
 * ticket is expensive: that pincode is what technician eligibility, area-manager
 * visibility and the proof geo-check all route on, so six digits we do not hold
 * produce a job nobody can be offered and no screen that says why.
 *
 * So this owns three things the forms should not each re-derive:
 *
 *  1. **Search fills the fields.** Google Places, restricted to India. Picking a
 *     result writes the street line, city, state and pincode at once.
 *  2. **The pincode is checked against OUR master, however it arrived.** Typed
 *     by hand or autofilled, the same lookup runs and a code the geography
 *     master does not hold is refused with a reason.
 *  3. **Manual entry always works.** No key, no network, no matching result,
 *     or somebody who would simply rather type — every one of those paths ends
 *     at the same five editable boxes. The search box is an accelerator, never
 *     a gate.
 *
 * Controlled, like `technicians/CoverageFields` and `settings/ScopeField`: the
 * caller owns the values, this owns the behaviour.
 *
 * **The caller must gate its submit on `onStatusChange`.** A `zodResolver` wipes
 * a manually-set RHF error on the next validation pass, so `setError` would not
 * hold — see the three call sites.
 */

/**
 * - `idle` — no six-digit code to check yet.
 * - `checking` — the lookup is in flight.
 * - `ok` — in the master.
 * - `unknown` — a real answer: we do not hold it. **Block submit.**
 * - `unavailable` — we could not ask. **Never block** — a dropped request is
 *   our problem, not the customer's address.
 */
export type AddressStatus =
  | "idle"
  | "checking"
  | "ok"
  | "unknown"
  | "unavailable";

export interface AddressValue {
  /** The street line. Line 1 when `lines` is 2. */
  address: string;
  /** Only used when `lines` is 2; otherwise it is folded into `address`. */
  addressLine2: string;
  city: string;
  state: string;
  pincode: string;
  /**
   * Where the address is, set ONLY by picking it from the search box.
   *
   * Null after any hand edit, and that is enforced below rather than left to
   * each caller. A point that describes the address as it was picked stops
   * describing it the moment somebody retypes the street line — and the server
   * ENFORCES this point when verifying the technician's site photo, so a stale
   * one would refuse a technician standing at the right door. No point is a
   * supported state; a wrong point is not.
   */
  latitude?: number | null;
  longitude?: number | null;
}

/** The text boxes. The coordinates are not one, which is why they are excluded. */
type Part = Exclude<keyof AddressValue, "latitude" | "longitude">;

export interface AddressFieldsProps {
  value: AddressValue;
  onChange: (next: AddressValue) => void;
  /** Unique per form — every id and every `aria-describedby` is built from it. */
  idPrefix: string;
  /** One street box (vendor, ticket) or line 1 + line 2 (company). */
  lines?: 1 | 2;
  /** Render the street line as a textarea, keeping line breaks. */
  multiline?: boolean;
  labels?: Partial<Record<Part, string>>;
  /**
   * Which boxes draw the red required mark. Per part rather than a single flag,
   * because the caller's schema is the only thing that knows: line 2 is optional
   * on every form that shows it, and the other four are not.
   */
  required?: Partial<Record<Part, boolean>>;
  placeholders?: Partial<Record<Part, string>>;
  hints?: Partial<Record<Part, string>>;
  /** RHF messages. Rendered the house way — `role="alert"`, pointed at by the control. */
  errors?: Partial<Record<Part, string>>;
  onStatusChange?: (next: AddressStatus) => void;
  /**
   * Emit native `autocomplete` hints. Off for the vendor dialog, which
   * suppresses browser autofill across every field for its own reasons.
   */
  autoFill?: boolean;
  disabled?: boolean;
  /**
   * Whether the Google-backed search is offered, and where to report a session.
   *
   * A PROP, never read from the session here. This control is `shared/` — the
   * caller owns the values and this owns the behaviour — and a component that
   * looked up `me` itself could not be reused on a staff or superadmin form.
   * It also could not tell the two meanings of `me.vendor === null` apart: for
   * a staff caller it means "not a vendor" (search on), for a broken portal
   * account it means "no vendor" (off). The caller knows which it is.
   *
   * Omit for search-on and record-nothing, which is the right default for any
   * form that is not a vendor's.
   */
  addressSearch?: {
    enabled: boolean;
    onSearch: (sessionId: string) => void;
  };
  /** Grid class for the field group holding all five boxes. */
  grid?: string;
  /** Column span for the street line inside that grid. */
  addressClassName?: string;
  /** An extra cell appended to the grid — the ticket form's Expected date. */
  children?: React.ReactNode;
}

const DEFAULT_GRID = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3";

const DEFAULT_LABELS: Record<Part, string> = {
  address: "Address",
  addressLine2: "Address line 2",
  city: "City",
  state: "State",
  pincode: "Pincode",
};

const AUTOFILL: Record<Part, string> = {
  address: "address-line1",
  addressLine2: "address-line2",
  city: "address-level2",
  state: "address-level1",
  pincode: "postal-code",
};

const SIX_DIGITS = /^\d{6}$/;

export function AddressFields({
  value,
  onChange,
  idPrefix,
  lines = 1,
  multiline = false,
  labels,
  required,
  placeholders,
  hints,
  errors,
  onStatusChange,
  autoFill = true,
  disabled,
  addressSearch,
  grid,
  addressClassName,
  children,
}: AddressFieldsProps) {
  // Passed INTO the hook rather than used to hide the box below, so a vendor
  // switched off never fetches the Maps SDK either. `available` covers both
  // reasons the search can be absent — no key, or not offered to this vendor —
  // and the render branch stays the single condition it already was.
  const places = useAddressAutocomplete({
    enabled: addressSearch?.enabled,
    onSearch: addressSearch?.onSearch,
  });
  const [picked, setPicked] = React.useState<ComboboxOption | null>(null);
  /**
   * The last pick came back without a postal code.
   *
   * Google has no pincode for a road or a neighbourhood — picking "Brigade
   * Road" fills city and state and leaves the pincode blank. Silently, before
   * this: the user had chosen an address and the one field everything routes on
   * was still empty with nothing on screen to say so.
   */
  const [pickHadNoPincode, setPickHadNoPincode] = React.useState(false);

  const lookup = usePincodeLookup(value.pincode);
  const master = lookup.data ?? null;

  /**
   * The pincode is PICKED from the master, not typed into a free box — the
   * same rule `technicians/CoverageFields` follows, and for the same reason: a
   * typo can no longer name a place that does not exist.
   *
   * Unfiltered, unlike the coverage picker, which narrows by region first.
   * There is no region on an address form, and the server's search already
   * matches code prefix, state and district — so two characters is enough to
   * make a 19,490-row table answer usefully.
   */
  const [pincodeQuery, setPincodeQuery] = React.useState("");
  const pincodeSearch = useInfinitePincodes(
    pincodeQuery,
    {},
    pincodeQuery.trim().length >= 2
  );

  const pincodeOptions = React.useMemo<ComboboxOption[]>(
    () =>
      pincodeSearch.rows.map((row) => ({
        value: row.code,
        // The code alone in the field — the district belongs on the second
        // line of the option, where it aids recognition without ending up in
        // the box.
        label: row.code,
        hint: [row.districts.join(", "), row.stateName]
          .filter(Boolean)
          .join(" · "),
      })),
    [pincodeSearch.rows]
  );

  /**
   * Typing all six digits of a real code selects it, without a click or Enter.
   *
   * A combobox normally insists you choose from the list, and for a pincode
   * that is one confirmation too many: the six digits ARE the answer, and the
   * single row underneath only repeats them. Somebody who types the code and
   * tabs on would otherwise leave the field empty and never know.
   *
   * Only ever selects a code the master actually returned, so this cannot put
   * an unserviceable value in the field.
   */
  React.useEffect(() => {
    const typed = pincodeQuery.trim();
    if (!SIX_DIGITS.test(typed) || typed === value.pincode) return;
    if (!pincodeSearch.rows.some((row) => row.code === typed)) return;
    // No need to clear `pickHadNoPincode` — it only renders while the pincode
    // is empty, and this is the moment it stops being empty.
    onChange({ ...value, pincode: typed });
  }, [pincodeQuery, pincodeSearch.rows, value, onChange]);

  /**
   * A search this component started on the user's behalf, after picking an
   * address Google had no pincode for. Held so the auto-fill below only ever
   * fires for a seeded search, never for something half-typed.
   */
  const seeded = React.useRef<string | null>(null);

  /**
   * One candidate is not a choice — fill it in.
   *
   * Hard rule 10 in `adminWeb/AGENTS.md`: a dropdown whose options are computed
   * from data auto-picks the sole option rather than making somebody open a
   * one-item menu. Picking "Chitegaon, Aurangabad" narrows to exactly one code,
   * and asking them to confirm it would be theatre.
   *
   * Only for the seeded search, and only while the field is empty — so it can
   * never override a real choice or fire off a partial word.
   */
  React.useEffect(() => {
    if (value.pincode || pincodeSearch.isFetching) return;
    if (!seeded.current || seeded.current !== pincodeQuery) return;
    if (pincodeSearch.total !== 1) return;
    const only = pincodeSearch.rows[0];
    if (!only) return;
    onChange({ ...value, pincode: only.code });
  }, [pincodeQuery, pincodeSearch.isFetching, pincodeSearch.rows, pincodeSearch.total, value, onChange]);

  /**
   * What the field shows. Derived from the value rather than held separately,
   * so a code that arrived from Google displays exactly like one that was
   * picked here.
   */
  const pincodeOption = React.useMemo<ComboboxOption | null>(() => {
    const code = value.pincode.trim();
    if (!code) return null;
    return {
      value: code,
      label: code,
      hint: master
        ? [master.districts.join(", "), master.stateName]
            .filter(Boolean)
            .join(" · ")
        : undefined,
    };
  }, [value.pincode, master]);

  const label = (part: Part) => labels?.[part] ?? DEFAULT_LABELS[part];
  /**
   * A hand edit to any box, which is also where the map point is thrown away.
   *
   * This is the single funnel for typing, so it is the right place for it: the
   * coordinates describe the address that was PICKED, and the moment a
   * character is typed they describe something else. Keeping them would hand
   * the server a point it enforces against the technician who turns up.
   *
   * The Places pick and the two pincode auto-fills call `onChange` directly
   * and so are unaffected — none of the three is somebody retyping an address.
   */
  const set = (patch: Partial<AddressValue>) =>
    onChange({ ...value, ...patch, latitude: null, longitude: null });

  const status: AddressStatus = !SIX_DIGITS.test(value.pincode.trim())
    ? "idle"
    : lookup.isPending
      ? "checking"
      : lookup.isError
        ? "unavailable"
        : master
          ? "ok"
          : "unknown";

  React.useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  /**
   * The code we last auto-filled a city for.
   *
   * Without it, clearing the city would refill it from the district on the very
   * next render and the box could never be emptied. The district is a helpful
   * first guess for a hand-typed code, not a value we insist on.
   */
  const filledFor = React.useRef<string | null>(null);

  /**
   * The master is the authority on which state a pincode is in — `pincodes`
   * carries a foreign key to `states`, and an area manager's coverage is a set
   * of state names — so a resolved code overwrites whatever Google or a typist
   * put in the State box. The box goes read-only at the same moment, because a
   * field that silently reverts what you type is worse than one you cannot type
   * in.
   */
  React.useEffect(() => {
    if (!master) return;
    const fresh = filledFor.current !== master.code;
    filledFor.current = master.code;
    const city = fresh && !value.city ? (master.districts[0] ?? "") : value.city;
    if (value.state === master.stateName && value.city === city) return;
    onChange({ ...value, state: master.stateName, city });
  }, [master, value, onChange]);

  async function choose(option: ComboboxOption | null) {
    setPicked(option);
    if (!option) return;
    const parts = await places.resolve(option.value);
    if (!parts) return;
    const next = lines === 1 ? flatten(parts) : parts;
    setPickHadNoPincode(next.pincode === "");
    // A new address means the previous city fill no longer applies.
    filledFor.current = null;
    /*
     * Whatever was last typed into the pincode box no longer applies either.
     * Left standing, the auto-commit above would see six digits it still had
     * rows for and put the OLD pincode straight back over the one just chosen.
     *
     * When Google gave no pincode — which it does not for a road or a
     * neighbourhood, since an area that size spans several — the box is seeded
     * with the place name instead. Our master matches on district and state, so
     * "Chitegaon" or "Bengaluru" narrows 19,490 codes to that place's own, and
     * the dropdown is already showing the right shortlist before it is opened.
     * Exactly one match fills itself.
     */
    const seedFrom = next.pincode ? "" : next.city.trim();
    seeded.current = seedFrom || null;
    setPincodeQuery(seedFrom);
    onChange({
      address: next.address || value.address,
      addressLine2: next.addressLine2,
      city: next.city,
      // State is provisional until the pincode lookup confirms it — the effect
      // above replaces it with the master's spelling a moment later.
      state: next.state,
      pincode: next.pincode,
      // The one moment these are valid: they came back with the address on
      // this same pick. `set` nulls them again on any hand edit.
      latitude: next.latitude,
      longitude: next.longitude,
    });
  }

  const pincodeHelp = `${idPrefix}-pincode-help`;
  const pincodeError = errors?.pincode;

  /** The line under the pincode: what it resolved to, or why it did not. */
  const resolution = (() => {
    if (pincodeError) return null;
    // Typing anything clears this by itself — no reset to wire up.
    if (pickHadNoPincode && value.pincode.trim() === "")
      return {
        tone: "warn" as const,
        // Named rather than generic: the shortlist is already loaded for that
        // place, so "pick one" is a real instruction and not a shrug.
        text: pincodeOptions.length
          ? `That address has no pincode — pick one for ${value.city || "it"}.`
          : "That address has no pincode — search for one.",
      };
    if (status === "checking")
      return { tone: "muted" as const, text: "Checking…" };
    if (status === "unknown")
      return {
        tone: "danger" as const,
        text: `We don't service pincode ${value.pincode.trim()}.`,
      };
    if (status === "unavailable")
      return {
        tone: "warn" as const,
        text: "Couldn't check this pincode right now.",
      };
    if (status === "ok" && master)
      return {
        tone: "ok" as const,
        text: [
          master.districts.join(", "),
          master.stateName,
          master.regionName,
        ]
          .filter(Boolean)
          .join(" · "),
      };
    return null;
  })();

  /**
   * The plain text fields. The pincode is NOT one of them — it is a combobox
   * over the master, built out below.
   */
  const box = (
    part: Exclude<Part, "pincode">,
    extra?: { className?: string; readOnly?: boolean }
  ) => {
    const id = `${idPrefix}-${part}`;
    const message = errors?.[part];
    const hint = hints?.[part];
    const describedBy = message
      ? `${id}-error`
      : hint
        ? `${id}-hint`
        : undefined;
    const shared = {
      id,
      value: value[part],
      onChange: (
        event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
      ) => set({ [part]: event.target.value }),
      placeholder: placeholders?.[part],
      autoComplete: autoFill ? AUTOFILL[part] : "off",
      readOnly: extra?.readOnly,
      disabled,
      "aria-invalid": message ? true : undefined,
      "aria-describedby": describedBy,
    };
    return (
      <Field
        data-invalid={message ? true : undefined}
        className={extra?.className}
      >
        <FieldLabel htmlFor={id} required={required?.[part]}>
          {label(part)}
        </FieldLabel>
        {multiline && part === "address" ? (
          <Textarea {...shared} rows={2} className="resize-y" />
        ) : (
          <Input
            {...shared}
            // A field filled in for you should look filled in for you, not
            // like one you forgot.
            className={cn(extra?.readOnly && "bg-surface-2 text-ink-2")}
          />
        )}
        {hint && !message ? (
          <FieldDescription id={`${id}-hint`}>{hint}</FieldDescription>
        ) : null}
        {message ? (
          <FieldDescription id={`${id}-error`} role="alert" className="text-danger">
            {message}
          </FieldDescription>
        ) : null}
      </Field>
    );
  };

  return (
    <div className="grid gap-4">
      {places.available ? (
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-address-search`}>
            Search address
          </FieldLabel>
          <Combobox
            id={`${idPrefix}-address-search`}
            value={picked}
            onValueChange={(option) => void choose(option)}
            options={places.options}
            onSearch={places.search}
            loading={places.loading}
            disabled={disabled}
            icon={<MapPin className="size-3.5" />}
            placeholder="Start typing an address"
            emptyMessage="No address matches that — fill the fields in below"
            aria-describedby={`${idPrefix}-address-search-hint`}
          />
          <FieldDescription id={`${idPrefix}-address-search-hint`}>
            Pick a result to fill the fields below, or type them in yourself.
          </FieldDescription>
        </Field>
      ) : null}

      <FieldGrid className={grid ?? DEFAULT_GRID}>
        {box("address", { className: addressClassName })}
        {lines === 2 ? box("addressLine2") : null}
        {/* Pincode leads the row, ahead of City and State, because it now
            DECIDES both: picking one fills the city from its district and the
            state from the master. Asking for a city first and then overwriting
            it a moment later is the wrong order to put a person through. */}
        <Field data-invalid={pincodeError ? true : undefined}>
          <FieldLabel htmlFor={`${idPrefix}-pincode`} required={required?.pincode}>
            {label("pincode")}
          </FieldLabel>
          <Combobox
            id={`${idPrefix}-pincode`}
            value={pincodeOption}
            onValueChange={(option) => {
              set({ pincode: option?.value ?? "" });
              setPickHadNoPincode(false);
            }}
            options={pincodeOptions}
            onSearch={(next) => {
              // Anything typed is the user's own search, so the seeded one is
              // over and its auto-fill must not fire against their text.
              if (next !== seeded.current) seeded.current = null;
              setPincodeQuery(next);
            }}
            loading={pincodeSearch.isLoading}
            onLoadMore={pincodeSearch.fetchNextPage}
            hasMore={pincodeSearch.hasNextPage}
            loadingMore={pincodeSearch.isFetchingNextPage}
            // What they type IS the answer, so Enter should take it rather than
            // making them reach for the mouse to confirm their own six digits.
            autoHighlight
            disabled={disabled}
            placeholder={placeholders?.pincode ?? "Search a pincode or a place"}
            emptyMessage={
              SIX_DIGITS.test(pincodeQuery.trim())
                ? `We don't service pincode ${pincodeQuery.trim()}.`
                : pincodeQuery.trim().length >= 2
                  ? "No pincode matches that"
                  : "Type a pincode, district or state"
            }
            aria-invalid={pincodeError ? true : undefined}
            aria-describedby={
              pincodeError
                ? `${idPrefix}-pincode-error`
                : resolution
                  ? pincodeHelp
                  : undefined
            }
          />
          {resolution ? (
            <FieldDescription
              id={pincodeHelp}
              // Only the refusal is an alert. Announcing every successful
              // resolution would interrupt a screen-reader user mid-form.
              role={resolution.tone === "danger" ? "alert" : undefined}
              className={cn(
                resolution.tone === "danger" && "text-danger",
                resolution.tone === "warn" && "text-warn",
                resolution.tone === "ok" && "text-ok"
              )}
            >
              {resolution.text}
            </FieldDescription>
          ) : null}
          {pincodeError ? (
            <FieldDescription
              id={`${idPrefix}-pincode-error`}
              role="alert"
              className="text-danger"
            >
              {pincodeError}
            </FieldDescription>
          ) : null}
        </Field>
        {box("city")}
        {box("state", {
          // Derived from the pincode once we know it. Editable until then, so a
          // manual entry can be completed in any order.
          readOnly: status === "ok",
        })}
        {children}
      </FieldGrid>
    </div>
  );
}
