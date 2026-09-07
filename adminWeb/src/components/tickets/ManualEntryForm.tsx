import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AddressFields,
  type AddressStatus,
  type AddressValue,
} from "@/components/shared/AddressFields";
import { FieldGrid } from "@/components/shared/FieldGrid";
import { FormSection } from "@/components/shared/FormSection";
import { Link } from "react-router";
import type { Control } from "react-hook-form";
import { Controller, useController, useForm, useWatch } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { moneyPaise } from "@/utils/money";
import { useAutoSelectSingle } from "@/hooks/useAutoSelectSingle";
import { useNodeTree } from "@/hooks/useProductMaster";
import { lookupSerial } from "@/services/productMaster";
import { cn } from "@/lib/utils";
import { istToday, offeredSlots, type OfferedSlot } from "@/utils/slots";
import type { VendorOption } from "@/types/vendor";
import type { CreateTicketInput } from "@/types/ticket";
import { nodeIdPath, type ProductNode, type SerialMatch } from "@/types/product";
import {
  SERVICE_LEVEL_OPTIONS,
  ticketSchema,
  type TicketFormValues,
} from "./ticketSchema";

/** `{ value, label }` because the selects now store ids and show names. */
interface Option {
  value: string;
  label: string;
}

interface OptionGroup {
  /** A parent category — rendered as the dropdown's group heading. */
  label?: string;
  options: Option[];
}

interface ManualEntryFormProps {
  onSubmit: (values: CreateTicketInput) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  /**
   * The brand this ticket is raised against, already known.
   *
   * REQUIRED, because the only caller is the vendor portal — a vendor does not
   * choose which vendor it is. Passing it replaces the vendor select with a
   * read-only field and skips `useVendorOptions()` entirely: that endpoint is
   * gated on `masters.view` and, for a staff caller, lists every brand in the
   * company. A vendor must neither need it nor see its result.
   */
  vendor: VendorOption;
  /**
   * Whether this vendor is offered the address search, and where to report a
   * session so the console can count it.
   *
   * REQUIRED, for the same reason `vendor` is: the capability belongs to a
   * vendor, this form is only ever a vendor's, and a caller that inherited a
   * default would be spending somebody's Google quota without deciding to.
   */
  addressSearch: {
    enabled: boolean;
    onSearch: (sessionId: string) => void;
  };
}

export function ManualEntryForm({
  onSubmit,
  onCancel,
  isSubmitting,
  vendor,
  addressSearch,
}: ManualEntryFormProps) {

  const {
    control,
    register,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<TicketFormValues>({
    resolver: zodResolver(ticketSchema),
    defaultValues: {
      vendorId: vendor.id,
      subcategoryId: "",
      modelId: "",
      serviceType: "Installation + Demo",
      description: "",
      serialNumber: "",
      customerName: "",
      customerPhone: "",
      address: "",
      city: "",
      state: "",
      pincode: "",
      latitude: null,
      longitude: null,
      expectedDate: "",
      serviceLevelHours: 24,
      slotStart: "",
      slotEnd: "",
    },
  });

  /**
   * The category drill-down's answer so far — one node id per level.
   *
   * Local rather than form state, and deliberately: the intermediate levels are
   * how somebody reached the product, not part of the ticket. Only the final
   * leaf lands in `subcategoryId`, which is the single id the API takes.
   *
   * It cannot go stale: `vendorId` is fixed for the life of this form (the
   * vendor is a read-only box, not a picker), so the tree it indexes into never
   * changes underneath it. `resolveChain` still truncates on a miss rather than
   * trusting that.
   */
  const [picked, setPicked] = useState<string[]>([]);

  // Models belong to a subcategory, so the second select depends on the first.
  // useWatch subscribes to just this field — watch() re-renders on every
  // keystroke anywhere in the form and isn't memoization-safe.
  const vendorId = useWatch({ control, name: "vendorId" });
  const modelId = useWatch({ control, name: "modelId" });
  const serviceType = useWatch({ control, name: "serviceType" });
  const slotStart = useWatch({ control, name: "slotStart" });
  // The windows on offer depend on it, so the picker has to redraw when the
  // service level changes — a 12h ticket has far fewer than a 48h one.
  const serviceLevelHours = useWatch({ control, name: "serviceLevelHours" });

  /* The address is one control over four form fields, so it is watched and
     written rather than registered. `AddressFields` owns the Google lookup and
     the check against the geography master; the form owns the values. */
  const address = useWatch({ control, name: "address" });
  const city = useWatch({ control, name: "city" });
  const state = useWatch({ control, name: "state" });
  const pincode = useWatch({ control, name: "pincode" });
  const latitude = useWatch({ control, name: "latitude" });
  const longitude = useWatch({ control, name: "longitude" });
  const addressValue = useMemo<AddressValue>(
    () => ({ address, addressLine2: "", city, state, pincode, latitude, longitude }),
    [address, city, state, pincode, latitude, longitude]
  );
  const setAddress = useCallback(
    (next: AddressValue) => {
      setValue("address", next.address, { shouldDirty: true });
      setValue("city", next.city, { shouldDirty: true });
      setValue("state", next.state, { shouldDirty: true });
      setValue("pincode", next.pincode, { shouldDirty: true });
      // Set together with the address they describe, and nulled by
      // `AddressFields` the moment one of the boxes above is hand-edited — a
      // point that has stopped matching its address is worse than no point,
      // because the server enforces it against the technician who turns up.
      setValue("latitude", next.latitude ?? null, { shouldDirty: true });
      setValue("longitude", next.longitude ?? null, { shouldDirty: true });
    },
    [setValue]
  );
  /* A pincode the geography master does not hold is refused here, not by the
     schema: `zodResolver` clears a manually-set error on the next validation
     pass, so `setError` would not survive the submit it is meant to stop.
     This one matters more than the other two forms — the ticket's pincode is
     what technician eligibility and area-manager visibility both route on. */
  const [addressStatus, setAddressStatus] = useState<AddressStatus>("idle");
  const addressBlocked =
    addressStatus === "unknown" || addressStatus === "checking";

  /* The whole picker is a cascade, and the vendor is the top of it: a ticket is
     raised against a specific brand's product, so the categories on offer are
     the ones that vendor actually makes something in. Narrowing on the server
     rather than filtering here means the empty case is a fact the API states,
     not something the form has to infer from an empty array.

     `intake` is what makes that true of APPROVAL too. A vendor can now add
     products themselves, and one nobody has priced cannot be ticketed — so the
     server hides it and prunes whatever branch that empties. This form needed
     no filtering logic of its own for the same reason it never needed any for
     paused products. */
  const { data: tree, isPending: treePending } = useNodeTree(
    false,
    vendorId,
    "intake"
  );
  const vendorName = vendor.name;
  // A vendor with nothing to install is a gap in the master, not a dead end for
  // the person keying in a ticket — so it is named, with somewhere to go.
  const vendorHasNothing =
    Boolean(vendorId) && !treePending && (tree ?? []).length === 0;

  /* The category picker is a DRILL-DOWN: one dropdown per level, each filled
     from what was chosen above it.

     It was briefly one flattened select labelled with breadcrumbs. That reads
     fine with six products and badly with sixty — the list becomes every leaf
     in the catalogue at once, and the person keying a ticket has to recognise
     `TV › Android TV › 32 inch` rather than answer three easy questions. Going
     level by level also means each list is short enough to scan, and a single
     option fills itself (hard rule 10), so a shallow branch costs no clicks.

     The number of dropdowns is data, not layout: it grows as somebody drills
     and stops at the level marked as the last sub-category. Everything on offer
     leads somewhere, because the server already pruned every branch holding
     none of THIS vendor's products.

     `picked` is local rather than form state — the intermediate levels are how
     you got to the answer, not the answer. Only the final leaf reaches
     `subcategoryId`, which is what the API takes. */
  const chain = resolveChain(tree, picked);
  const levels: { parentId: string; options: ProductNode[]; value: string }[] = [];
  {
    let pool: ProductNode[] = tree ?? [];
    for (let i = 0; ; i += 1) {
      const node = chain[i];
      levels.push({
        parentId: i === 0 ? "root" : chain[i - 1].id,
        options: pool,
        value: node?.id ?? "",
      });
      // Stop at an unanswered level, at the last sub-category, or at a branch
      // with nothing under it (which pruning should already have removed).
      if (!node || node.isLeaf || node.children.length === 0) break;
      pool = node.children;
    }
  }

  // Products hang off the level marked as the last sub-category, and only that
  // one — so until the drill-down reaches one there is nothing to pick from.
  const last = chain.at(-1);
  const chosen = last?.isLeaf ? last : undefined;

  function pickLevel(level: number, id: string) {
    // Truncate: choosing a different TV throws away the Android TV under it.
    setPicked((prev) => [...prev.slice(0, level), id]);
    const node = levels[level]?.options.find((n) => n.id === id);
    // Only a leaf is an answer. Anything above it leaves the field empty, so
    // submitting mid-drill fails validation on the box that is still blank.
    setValue("subcategoryId", node?.isLeaf ? id : "", { shouldValidate: false });
    setValue("modelId", "", { shouldValidate: false });
    setValue("serviceType", "Installation + Demo", { shouldValidate: false });
  }

  const modelGroups: OptionGroup[] = [
    {
      options: (chosen?.models ?? []).map((m) => ({
        value: m.id,
        label: m.name,
      })),
    },
  ];

  /* The service types on offer are the ones the CHOSEN MODEL declares it
     supports — a microwave that only does installation must not be raised as a
     Tech Visit. The server enforces the same rule; this stops the user finding
     out after they submit. */
  const model = chosen?.models.find((m) => m.id === modelId);
  const serviceTypeGroups: OptionGroup[] = [
    { options: (model?.serviceTypes ?? []).map((t) => ({ value: t, label: t })) },
  ];

  // Only these two carry a fault to describe. An installation explains itself.
  const needsProblem = serviceType === "Tech Visit" || serviceType === "Service";

  /* ── autofill from the serial number ──────────────────────────────────────
     The vendor's real starting point is a unit with a number printed on it.
     Everything above — the category chain, the model, the service type — is
     something they otherwise have to work out FROM that number, and the master
     already knows. So typing the serial fills the rest in.

     Only on an exact match, which is also all the server answers: a partial
     serial picks the wrong product as often as the right one, and four fields
     filled from a half-typed number are worse than four empty ones. */
  const serialNumber = useWatch({ control, name: "serialNumber" });
  const [matches, setMatches] = useState<SerialMatch[]>([]);
  /* The suggestion list under the box. Open is its own state rather than
     `matches.length > 0`, because picking one has to shut it while the matches
     it was built from are still perfectly valid. */
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const serialBoxRef = useRef<HTMLDivElement>(null);

  /* Dismissed by an outside pointerdown rather than by the input's blur.
     `register` owns `onBlur` — it is what marks the field touched — so passing
     our own through `TextField` would replace it and quietly break validation
     on this one box. An outside click is also the more correct trigger: it
     leaves the list open while the pointer is on its way to a row. */
  useEffect(() => {
    if (!suggestOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!serialBoxRef.current?.contains(e.target as Node)) {
        setSuggestOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [suggestOpen]);

  const applyMatch = useCallback(
    (hit: SerialMatch) => {
      // A match the drill-down cannot reach is not one to fill. The intake tree
      // hides unapproved and paused branches, so this is what keeps a product
      // the vendor could not actually submit out of the form.
      const path = nodeIdPath(tree, hit.nodeId);
      if (!path) return;
      setPicked(path);
      setValue("subcategoryId", hit.nodeId, { shouldValidate: false });
      setValue("modelId", hit.modelId, { shouldValidate: false });
      setValue("serviceType", hit.serviceTypes[0] ?? "Installation + Demo", {
        shouldValidate: false,
      });
      // Normalisation, never a content change: the match was EXACT, so this can
      // differ only in case or surrounding space. Worth doing — the ticket would
      // otherwise print a serial the master spells differently.
      setValue("serialNumber", hit.serial, { shouldValidate: false });
    },
    [tree, setValue]
  );

  /* Looked up as a MUTATION rather than a query, because that is what this
     actually is: a user action, an async answer, and form state written from
     the reply. A `useQuery` would mean reacting to its data in an effect, and
     a fill triggered from an effect body is a cascading render — the shape
     `react-hooks/set-state-in-effect` exists to stop.

     It also removes a piece of state. Nothing has to remember which serial it
     already filled from, because the fill happens once per REPLY rather than on
     every render: clearing the model by hand (which `pickLevel` does) no longer
     re-triggers anything, so the autofill cannot fight the user. */
  const lookup = useMutation({
    mutationFn: (serial: string) => lookupSerial(serial),
    // A lookup that fails leaves the form exactly as the vendor typed it. There
    // is nothing to report: the serial may simply not be loaded, and the server
    // is the authority on that at submit either way.
    onSuccess: (found) => {
      setMatches(found);
      setActiveIndex(-1);
      // The reply is a PREFIX search, so "did they finish typing one of these?"
      // is asked here rather than by the server. Only an exact hit fills.
      const typed = (getValues("serialNumber") ?? "").trim().toLowerCase();
      const exact = found.filter((f) => f.serial.toLowerCase() === typed);
      if (exact.length === 1) {
        // A model already chosen is the user's, not ours to overwrite.
        // Agreement needs nothing done; a disagreement becomes the offer below.
        if (!getValues("modelId")) applyMatch(exact[0]);
        // Closed in BOTH cases, and that is the fix for a loop rather than a
        // nicety: picking a suggestion writes the serial, which re-runs this
        // lookup, which would otherwise re-open the list over a box that is
        // already settled. An exact hit leaves nothing to choose.
        setSuggestOpen(false);
      } else {
        setSuggestOpen(found.length > 0);
      }
    },
    onError: () => {
      setMatches([]);
      setSuggestOpen(false);
    },
  });

  const pickSuggestion = useCallback(
    (hit: SerialMatch) => {
      applyMatch(hit);
      setSuggestOpen(false);
      setActiveIndex(-1);
    },
    [applyMatch]
  );

  function onSerialKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!suggestOpen || matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter" && activeIndex >= 0) {
      // Or the form submits from inside a dropdown somebody was navigating.
      e.preventDefault();
      pickSuggestion(matches[activeIndex]);
    } else if (e.key === "Escape") {
      setSuggestOpen(false);
    }
  }

  useEffect(() => {
    const value = (serialNumber ?? "").trim();
    // setState only inside the timer, never beside it — a synchronous one here
    // cascades a render on every keystroke. Below three characters the matches
    // are cleared rather than skipped, so deleting a serial takes its notice
    // away with it.
    const id = setTimeout(() => {
      if (value.length < 3) {
        setMatches([]);
        setSuggestOpen(false);
      } else lookup.mutate(value);
    }, 300);
    return () => clearTimeout(id);
    // `lookup` is a stable mutation object; depending on it would re-arm the
    // timer on every render and debounce nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialNumber]);

  /* `matches` is a PREFIX result, so several of them is the ordinary case and
     says nothing — it is a list to choose from. The interesting question is
     narrower: has this serial been typed out in full, and if so does exactly
     one product carry it? */
  const typedSerial = (serialNumber ?? "").trim().toLowerCase();
  const exactMatches = matches.filter(
    (m) => m.serial.toLowerCase() === typedSerial
  );
  const match = exactMatches.length === 1 ? exactMatches[0] : undefined;

  /** The serial names a DIFFERENT product than the one selected. An offer. */
  const conflicting =
    match && modelId && modelId !== match.modelId ? match : undefined;
  /** The selected model IS the serial's product — whether the form filled it or
   *  the user picked it by hand. Worth confirming either way: it tells the
   *  vendor the number will survive intake. */
  const confirmed = match && modelId === match.modelId ? match : undefined;

  const err = (name: keyof TicketFormValues) => errors[name]?.message;

  function submit(values: TicketFormValues) {
    // The button is disabled in this state, but a form can still be submitted
    // by keyboard while a check is in flight.
    if (addressBlocked) return;
    onSubmit({
      vendorId: values.vendorId,
      subcategoryId: values.subcategoryId,
      modelId: values.modelId,
      serviceType: values.serviceType,
      // Empty means "not recorded", which the API stores as null — never an
      // empty string, so "unknown" and "blank" cannot diverge.
      description: values.description.trim() || null,
      serialNumber: values.serialNumber.trim(),
      customerName: values.customerName,
      customerPhone: values.customerPhone,
      address: values.address,
      city: values.city,
      state: values.state,
      pincode: values.pincode,
      // Null when the address was typed. Sending them buys the distance check
      // on the technician's site photo; not sending them leaves this ticket on
      // the pincode rule, which is a complete ticket either way.
      latitude: values.latitude,
      longitude: values.longitude,
      expectedDate: values.expectedDate,
      serviceLevelHours: values.serviceLevelHours,
      // Already ISO instants — the picker stores the window it offered, so
      // there is no wall-clock string to reinterpret in some other zone.
      slotStart: values.slotStart || null,
      slotEnd: values.slotEnd || null,
    });
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate>
      <Card>
        <CardContent className="flex flex-col gap-6">
          <FormSection legend={<>Vendor &amp; product</>}>
            {/* `FieldGrid`, not `<FieldGroup className="grid …">` — this is the
                form that found the Chrome bug that component exists to avoid.
                The billing line below is the sibling whose insertion collapsed
                every control here to height 0. */}
            {/* The serial comes FIRST, and that ordering is the feature.

                It used to sit below the four boxes it fills, which made the
                autofill unreachable in practice: by the time somebody reached
                it they had already picked the category, the model and the
                service type by hand, and the box could only agree with them.

                Read top-down it now matches what the vendor is actually doing —
                they are holding a unit with a number printed on it, and that
                number is the one fact they have before anything else. */}
            <FieldGrid className="grid gap-4 sm:grid-cols-2">
              {/* Read-only rather than a one-option select: there is nothing
                  to choose, and a disabled dropdown invites a click that does
                  nothing. Same treatment `ScopeField` gives a National Head's
                  "All India". The value is still submitted and still validated
                  — and the server independently refuses any vendor that is not
                  the caller's own. */}
              <Field>
                <FieldLabel htmlFor="vendor-name">Company / vendor</FieldLabel>
                <Input id="vendor-name" value={vendor.name} readOnly disabled />
              </Field>
              {/* `relative`, because the suggestion list is absolutely
                  positioned against it — and it is the element the outside-click
                  dismissal measures against, so the list must live INSIDE it or
                  clicking a row would count as outside and close before the
                  click lands. */}
              <div className="relative" ref={serialBoxRef}>
                <TextField
                  name="serialNumber"
                  label="Serial number"
                  required
                  placeholder="Start typing — the product fills in"
                  className="font-mono"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={64}
                  register={register}
                  error={err("serialNumber")}
                  role="combobox"
                  aria-expanded={suggestOpen}
                  aria-controls="serial-suggestions"
                  aria-autocomplete="list"
                  aria-activedescendant={
                    activeIndex >= 0 ? `serial-option-${activeIndex}` : undefined
                  }
                  onKeyDown={onSerialKeyDown}
                />
                {suggestOpen && matches.length > 0 ? (
                  <ul
                    id="serial-suggestions"
                    role="listbox"
                    aria-label="Matching serial numbers"
                    /* `bg-surface`, not `bg-surface-1` — there is no such
                       token, and Tailwind emits nothing for a name it cannot
                       resolve, so the list rendered fully transparent with the
                       form showing through it. The scale is
                       surface / surface-2 / surface-3. */
                    className="scroll-slim absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-lg"
                  >
                    {matches.map((hit, i) => (
                      <li
                        key={`${hit.modelId}-${hit.serial}`}
                        id={`serial-option-${i}`}
                        role="option"
                        aria-selected={i === activeIndex}
                        /* `onPointerDown`, not `onClick`: the dismissal above
                           listens on pointerdown, and a click would arrive
                           after the list had already been torn down. */
                        onPointerDown={(e) => {
                          e.preventDefault();
                          pickSuggestion(hit);
                        }}
                        onPointerEnter={() => setActiveIndex(i)}
                        className={cn(
                          "cursor-pointer px-3 py-1.5",
                          i === activeIndex ? "bg-surface-2" : undefined
                        )}
                      >
                        <span className="font-mono text-[13px] text-ink">
                          {hit.serial}
                        </span>
                        {/* The product, because the serial alone does not say
                            what it is — and choosing between two similar
                            numbers is exactly what this list is for. */}
                        <span className="block text-[11px] text-ink-3">
                          {hit.modelName} · {hit.nodePath.join(" › ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </FieldGrid>

            {/* What the serial says about the rest of the form. Three states,
                each answering a different question:
                  confirmed    the model and the serial agree — say so, both
                               because the form may have just filled three boxes
                               on its own and because it means intake will
                               accept the number
                  conflicting  they disagree. An OFFER, never a silent switch:
                               the model may be what the user meant and the
                               serial the typo
                  several      two products carry the number, so the form asks
                Silence otherwise, including on no match — most serials are not
                loaded, and that is not a failure worth a line of text. */}
            {confirmed ? (
              <FieldDescription className="text-ok">
                Matches {confirmed.nodePath.join(" › ")} ›{" "}
                {confirmed.modelName}.
              </FieldDescription>
            ) : conflicting ? (
              <FieldDescription className="flex flex-wrap items-center gap-2 text-warn">
                <span>
                  This serial belongs to {conflicting.modelName}, not the model
                  selected below.
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => applyMatch(conflicting)}
                >
                  Use {conflicting.modelName}
                </Button>
              </FieldDescription>
            ) : exactMatches.length > 1 ? (
              <FieldDescription className="text-warn">
                {exactMatches.length} products carry this exact serial — pick
                one from the list, or set the category and model below.
              </FieldDescription>
            ) : null}
            {/* Said once, here, because "which serial?" is the obvious question
                and the answer decides whether AI review can do its job. */}
            <FieldDescription>
              The serial you EXPECT to find, off the invoice — the technician
              photographs the real one on site, and a mismatch is what AI review
              catches. Enter it and the boxes below fill themselves in; pick
              them by hand if it is not on record yet.
            </FieldDescription>

            <FieldGrid className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {/* One box per level, appearing as the previous one is answered.
                  Keyed on the PARENT, not the index: picking a different TV
                  replaces the list below it, and an index key would leave the
                  old selection sitting in a box that now lists other things. */}
              {levels.map((level, i) => (
                <SelectShell
                  key={level.parentId}
                  id={`field-node-${i}`}
                  label={i === 0 ? "Category" : "Sub-category"}
                  required
                  placeholder={
                    i > 0
                      ? "Select sub-category"
                      : !vendorId
                        ? "Pick a vendor first"
                        : vendorHasNothing
                          ? `${vendorName} has nothing approved yet`
                          : "Select category"
                  }
                  groups={[
                    {
                      options: level.options.map((n) => ({
                        value: n.id,
                        label: n.name,
                      })),
                    },
                  ]}
                  value={level.value}
                  onChange={(id) => pickLevel(i, id)}
                  disabled={!vendorId || vendorHasNothing}
                  /* The chain's error belongs on the LAST box — that is where
                     the missing choice actually is. */
                  error={i === levels.length - 1 ? err("subcategoryId") : undefined}
                />
              ))}
              <SelectField
                name="modelId"
                label="Product model"
                required
                placeholder={
                  chosen ? "Select model" : "Pick a category first"
                }
                groups={modelGroups}
                disabled={!chosen}
                control={control}
                error={err("modelId")}
                onChanged={() =>
                  setValue("serviceType", "Installation + Demo", {
                    shouldValidate: false,
                  })
                }
              />
              <SelectField
                name="serviceType"
                label="Service type"
                required
                placeholder={modelId ? "Select type" : "Pick a model first"}
                groups={serviceTypeGroups}
                disabled={!modelId}
                control={control}
                error={err("serviceType")}
              />
            </FieldGrid>

            {/* What this ticket will cost, shown before it is raised rather
                than discovered on an invoice. It appears the moment a model is
                picked, because the price belongs to the model — the service
                type does not change it.

                `vendorPricePaise` only. The model also carries what the
                technician is paid, and the server sends that as null to a
                vendor; this deliberately does not read it, so the number a
                vendor must never see is not even referenced on the one form
                they use most. */}
            {model ? (
              <div className="flex flex-col gap-2.5">
                <p className="text-sm text-ink-2">
                  Raising this ticket will be billed at{" "}
                  <span className="font-semibold text-ink">
                    {moneyPaise(model.vendorPricePaise)}
                  </span>
                  .
                </p>

                {/* The product's own specs, so the vendor can confirm they
                    picked the right unit BEFORE raising the ticket — which is
                    the only moment anybody can still cheaply change their mind.
                    They were saved and editable but visible nowhere except the
                    tooltip of a chip on the masters screen.

                    Free to show here: the tree this form already fetched
                    carries them, so there is no extra request. */}
                {model.parameters.length ? (
                  <dl className="flex flex-wrap gap-x-5 gap-y-1.5">
                    {model.parameters.map((p) => (
                      <div key={p.name} className="flex items-baseline gap-1.5">
                        <dt className="text-xs text-ink-3">{p.name}</dt>
                        <dd className="text-xs font-medium text-ink-2">
                          {p.value || "—"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}

                {/* Prose rather than a spec, so it reads as a sentence. */}
                {model.notes ? (
                  <p className="text-xs text-ink-3">{model.notes}</p>
                ) : null}
              </div>
            ) : null}

            {/* Only the two service types that describe a fault. Rendering it
                always would invite a description the API then refuses.

                Below the product now rather than beside the serial: which
                question to ask depends on the service type, so it cannot be
                answered before the model above has been settled. */}
            {needsProblem ? (
              <FieldGrid className="grid gap-4">
                <TextField
                  name="description"
                  label="What is the problem?"
                  /* Only rendered for Tech Visit and Service, and required for
                     exactly those two — the superRefine wants ten characters. */
                  required
                  placeholder="e.g. Cooling has dropped and the outdoor unit rattles"
                  register={register}
                  error={err("description")}
                />
              </FieldGrid>
            ) : null}
          </FormSection>

          {/* A dead end with a way out of it: an empty dropdown reads as broken,
              this reads as a task and links to where it is done.

              Card level, NOT inside the FieldSet above. A bare <p> among Fields
              is caught by the field CSS — `*:w-full` and the grid's stretch
              between them collapsed the whole select row to zero height, which
              looked exactly like the four dropdowns had vanished. The info
              banner at the foot of this form sits here for the same reason. */}
          {/* Says "nothing APPROVED", not "no product models yet". Since a
              vendor can submit their own, an empty tree here has two causes and
              only one of them means the catalogue is bare — the other is a
              product sitting in the approvals queue, which "no product models
              yet" would flatly deny to the person who submitted it yesterday.

              And it links to `/portal/products`, not `/categories`. This form
              is portal-only today (`VendorNewTicketPage` is its one consumer),
              and `/categories` is an ops route that bounces a vendor back to
              `/portal` — a dead link on the screen they use most. If an ops
              intake screen ever returns, this branch needs a second voice via a
              prop rather than a second guess here. */}
          {vendorHasNothing ? (
            <p className="flex items-start gap-2.5 rounded-md bg-warn-bg px-3.5 py-3 text-xs leading-relaxed text-warn">
              <Info className="mt-px size-4 shrink-0" aria-hidden />
              <span>
                {vendorName} has nothing approved to raise a ticket against
                yet.{" "}
                <Link
                  to="/portal/products"
                  className="font-semibold underline underline-offset-2"
                >
                  Check your products
                </Link>
                , or add one there — we price it before it can be ticketed.
              </span>
            </p>
          ) : null}

          <FormSection legend="Customer">
            <FieldGrid className="grid gap-4 sm:grid-cols-2">
              <TextField
                name="customerName"
                label="Customer name"
                required
                placeholder="Full name"
                autoComplete="name"
                register={register}
                error={err("customerName")}
              />
              <TextField
                name="customerPhone"
                label="Mobile number"
                required
                placeholder="+91 "
                inputMode="tel"
                autoComplete="tel"
                register={register}
                error={err("customerPhone")}
              />
            </FieldGrid>

            {/* The address is new. Without it the technician has a pincode and
                a name, which is enough to be dispatched and not enough to
                arrive. Expected date rides along in the same four-across row it
                has always been in — the grid is the caller's to set. */}
            <AddressFields
              idPrefix="ticket"
              value={addressValue}
              onChange={setAddress}
              onStatusChange={setAddressStatus}
              addressSearch={addressSearch}
              grid="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
              addressClassName="sm:col-span-2 xl:col-span-4"
              /* No pincode placeholder: it is a search over the geography
                 master now, and `AddressFields` prompts for that better than
                 "6-digit" would. */
              placeholders={{
                address: "Flat / building, street, area",
                city: "Pune",
                state: "Maharashtra",
              }}
              /* All four are `min(1)` in `ticketSchema`. Line 2 is not shown
                 here — this form runs on `lines: 1`. */
              required={{
                address: true,
                city: true,
                state: true,
                pincode: true,
              }}
              errors={{
                address: err("address"),
                city: err("city"),
                state: err("state"),
                pincode: err("pincode"),
              }}
            >
              <TextField
                name="expectedDate"
                label="Expected date"
                required
                type="date"
                // The picker itself refuses a past day, so the common mistake
                // never reaches validation. The schema and the API still check
                // it — a typed date ignores `min`.
                min={istToday()}
                register={register}
                error={err("expectedDate")}
              />
            </AddressFields>
          </FormSection>

          <FormSection legend="Service level">
            <Controller
              name="serviceLevelHours"
              control={control}
              render={({ field }) => (
                <RadioGroup
                  value={String(field.value)}
                  onValueChange={(v) => field.onChange(Number(v))}
                  className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
                >
                  {SERVICE_LEVEL_OPTIONS.map((o) => (
                    <label
                      key={o.value}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-md border px-3.5 py-3 transition-colors",
                        field.value === o.value
                          ? "border-brand-500 bg-brand-100/40"
                          : "border-line hover:border-brand-400"
                      )}
                    >
                      <RadioGroupItem value={String(o.value)} />
                      <span>
                        <span className="block text-[13px] font-semibold">
                          {o.title}
                        </span>
                        <span className="block text-xs text-ink-3">
                          {o.detail}
                        </span>
                      </span>
                    </label>
                  ))}
                </RadioGroup>
              )}
            />
          </FormSection>

          <FormSection legend="Slot (optional)">
            <SlotPicker
              control={control}
              serviceLevelHours={serviceLevelHours}
              error={err("slotStart")}
            />
            <FieldDescription>
              Fill this in if you already agreed a time on the call. Leave it
              blank and the customer is asked to pick one.
            </FieldDescription>
          </FormSection>

          {/* The single most misunderstood rule in the flow, stated on the
              screen where someone could get it wrong — and now stated to match
              what was actually entered, rather than always promising a request. */}
          <p className="flex items-start gap-2.5 rounded-md bg-info-bg px-3.5 py-3 text-xs leading-relaxed text-info">
            <Info className="mt-px size-4 shrink-0" aria-hidden />
            {/* A `<span>` around each sentence, not a fragment. This `<p>` is a
                flex row, and a fragment's children become SEPARATE anonymous
                flex items — so the `<b>` below split one sentence into three
                columns that wrapped independently. The two sibling banners in
                this file already wrap theirs; this one did not, and only the
                branch containing the `<b>` showed it. */}
            {slotStart ? (
              <span>
                The slot is locked to the ticket and it goes straight to
                eligible technicians. A technician accepts that fixed time — they
                never propose one.
              </span>
            ) : (
              <span>
                With no slot the ticket waits as <b>Slot Pending</b>. No
                technician is told it exists until a time is confirmed.
              </span>
            )}
          </p>
        </CardContent>
      </Card>

      <div className="mt-3.5 flex flex-wrap justify-end gap-2.5">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting || addressBlocked}>
          {isSubmitting && <Spinner data-icon="inline-start" />}
          {/* Follows the slot, like the banner above: with a time already
              agreed there is no request to send. */}
          {slotStart ? "Create ticket" : "Create ticket & request slot"}
        </Button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------
   Field wrappers — validation state is wired identically for every input:
   data-invalid on the Field, aria-invalid on the control, and the message
   in a role="alert" the control points at.
   ---------------------------------------------------------------------- */

/**
 * The slot, chosen from the windows a customer could have picked.
 *
 * A menu rather than two `datetime-local` boxes, and that is the whole fix: the
 * free inputs accepted any instant at all, so a vendor could type 19:03–21:05
 * on a 12-hour ticket and the ticket was born Breached, outside working hours,
 * in a window no technician's day has. The API refuses that now
 * (`check_slot_bookable`); offering only real windows means nobody has to be
 * refused to find out.
 *
 * Grouped by day, because "which day" and "what time" are how somebody who just
 * agreed a slot on the phone actually holds it.
 */
function SlotPicker({
  control,
  serviceLevelHours,
  error,
}: {
  control: Control<TicketFormValues>;
  serviceLevelHours: number;
  error?: string;
}) {
  const { field: start } = useController({ control, name: "slotStart" });
  const { field: end } = useController({ control, name: "slotEnd" });

  // Recomputed when the service level changes — shortening it can strand a
  // window that was on offer a moment ago.
  const slots = useMemo(
    () => offeredSlots(serviceLevelHours),
    [serviceLevelHours]
  );

  const days = useMemo(() => {
    const byDay = new Map<string, OfferedSlot[]>();
    for (const s of slots) {
      const list = byDay.get(s.day);
      if (list) list.push(s);
      else byDay.set(s.day, [s]);
    }
    return [...byDay.entries()];
  }, [slots]);

  const chosen = start.value;
  const stillOffered = slots.some((s) => s.start === chosen);

  // Dropping to a shorter service level can put the chosen window past the new
  // deadline. Clearing it is the honest outcome — the alternative is a trigger
  // rendering blank over a value that is still in the form and would be
  // refused on submit.
  useEffect(() => {
    if (chosen && !stillOffered) {
      start.onChange("");
      end.onChange("");
    }
  }, [chosen, stillOffered, start, end]);

  const id = "field-slot";

  if (slots.length === 0) {
    return (
      <p className="flex items-start gap-2.5 rounded-md bg-warn-bg px-3.5 py-3 text-xs leading-relaxed text-warn">
        <Info className="mt-px size-4 shrink-0" aria-hidden />
        <span>
          A {serviceLevelHours}h service level leaves no bookable window — every
          one of them is already past the deadline. Choose a longer service
          level, or leave this blank and the customer will be asked to pick.
        </span>
      </p>
    );
  }

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>Agreed window</FieldLabel>
      <Select
        value={chosen}
        onValueChange={(next) => {
          const slot = slots.find((s) => s.start === next);
          start.onChange(slot?.start ?? "");
          end.onChange(slot?.end ?? "");
        }}
      >
        <SelectTrigger
          id={id}
          className="w-full sm:max-w-100"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        >
          <SelectValue placeholder="Leave blank and ask the customer" />
        </SelectTrigger>
        <SelectContent>
          {days.map(([day, windows]) => (
            <SelectGroup key={day}>
              <SelectLabel>{day}</SelectLabel>
              {windows.map((s) => (
                <SelectItem key={s.start} value={s.start}>
                  {s.time}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      {error ? (
        <FieldDescription id={`${id}-error`} role="alert" className="text-danger">
          {error}
        </FieldDescription>
      ) : (
        <FieldDescription>
          Two-hour windows inside the {serviceLevelHours}h service level. The
          same ones the customer is offered.
        </FieldDescription>
      )}
    </Field>
  );
}

function TextField({
  name,
  label,
  required,
  error,
  register,
  ...input
}: {
  name: keyof TicketFormValues;
  label: string;
  /** Draws the red mark. Mirrors `ticketSchema` — never guess. */
  required?: boolean;
  error?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: any;
} & React.ComponentProps<typeof Input>) {
  const id = `field-${name}`;
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...register(name)}
        {...input}
      />
      {error ? (
        <FieldDescription
          id={`${id}-error`}
          role="alert"
          className="text-danger"
        >
          {error}
        </FieldDescription>
      ) : null}
    </Field>
  );
}

/**
 * A select bound to a FORM field.
 *
 * A thin wrapper over `SelectShell`, which carries the markup and the
 * auto-fill. The split exists because the category drill-down renders a box per
 * level and only its LAST one is a form field — the levels above it are how you
 * reached the answer, not the answer, so they have nothing to bind to.
 */
function SelectField({
  name,
  control,
  onChanged,
  ...rest
}: {
  name: keyof TicketFormValues;
  label: string;
  required?: boolean;
  placeholder: string;
  groups: OptionGroup[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any;
  error?: string;
  disabled?: boolean;
  onChanged?: () => void;
}) {
  const { field } = useController({ name, control });
  return (
    <SelectShell
      {...rest}
      id={`field-${name}`}
      value={field.value}
      onChange={(v) => {
        field.onChange(v);
        onChanged?.();
      }}
    />
  );
}

function SelectShell({
  id,
  label,
  required,
  placeholder,
  groups,
  value,
  onChange,
  error,
  disabled,
}: {
  id: string;
  label: string;
  required?: boolean;
  placeholder: string;
  groups: OptionGroup[];
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
}) {
  const options = groups.flatMap((g) => g.options);

  // The base control types its value as nullable (clearing a select). Nothing
  // here clears one, so a null is folded to "" — the empty value every caller
  // already stores.
  const select = (v: string | null) => onChange(v ?? "");

  // A dropdown with a single choice fills itself — but not while it's disabled
  // (the model select before a category is picked) or its list is empty. The
  // values are what the control stores, so ids here, not labels.
  //
  // On the drill-down this CASCADES, which is the point: a branch with one
  // sub-category at each level resolves itself down to the products in one
  // click rather than three identical ones.
  useAutoSelectSingle(
    options.map((o) => o.value),
    value,
    select,
    !disabled
  );

  // The trigger holds the id, so the label has to be looked up to display it.
  const selected = options.find((o) => o.value === value);

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      <Select value={value} onValueChange={select} disabled={disabled}>
        <SelectTrigger
          id={id}
          className="w-full"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        >
          <SelectValue placeholder={placeholder}>
            {() => selected?.label ?? placeholder}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {groups.map((group, i) => (
            <SelectGroup key={group.label ?? i}>
              {group.label ? (
                <SelectLabel>{group.label}</SelectLabel>
              ) : null}
              {group.options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      {error ? (
        <FieldDescription
          id={`${id}-error`}
          role="alert"
          className="text-danger"
        >
          {error}
        </FieldDescription>
      ) : null}
    </Field>
  );
}

/**
 * The nodes behind a list of picked ids, one level at a time.
 *
 * Each id has to be a child of the one before it, so an id that no longer
 * belongs at its level simply ends the chain — the boxes below it disappear
 * rather than showing a stale selection against a list that no longer contains
 * it.
 */
function resolveChain(
  tree: ProductNode[] | undefined,
  picked: string[]
): ProductNode[] {
  const chain: ProductNode[] = [];
  let pool: ProductNode[] = tree ?? [];
  for (const id of picked) {
    const node = pool.find((n) => n.id === id);
    if (!node) break;
    chain.push(node);
    if (node.isLeaf) break;
    pool = node.children;
  }
  return chain;
}
