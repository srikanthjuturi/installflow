import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AddressFields,
  type AddressStatus,
  type AddressValue,
} from "@/components/shared/AddressFields";
import { FieldGrid } from "@/components/shared/FieldGrid";
import { FormSection } from "@/components/shared/FormSection";
import { Link } from "react-router";
import type { Control, UseFormSetValue } from "react-hook-form";
import { Controller, useController, useForm, useWatch } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { usePurchasePlatforms } from "@/hooks/usePurchasePlatforms";
import {
  lookupSerial,
  SERIAL_PAGE_SIZE,
} from "@/services/productMaster";
import { cn } from "@/lib/utils";
import { istToday, offeredSlots, type OfferedSlot } from "@/utils/slots";
import type { VendorOption } from "@/types/vendor";
import type { CreateTicketInput, PurchaseMode } from "@/types/ticket";
import { nodeIdPath, type ProductNode, type SerialMatch } from "@/types/product";
import {
  PURCHASE_MODE_OPTIONS,
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

/**
 * E1 — the Platform select's own sentinel for "none of these, let me type
 * one". Deliberately a non-empty string: Radix's `Select.Item` cannot carry
 * an empty value, and this must also never collide with a real platform id
 * (a UUID). It lives only in `platformChoice`, component state the schema
 * never sees — the form writes either a real `purchasePlatformId` or a
 * typed `purchasePlatformName` into RHF, never this sentinel itself, so
 * `ticketSchema` and the API need no idea it exists.
 */
const OTHERS_PLATFORM = "__others__";

interface ManualEntryFormProps {
  onSubmit: (values: CreateTicketInput) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  /**
   * The vendor this ticket is raised by, already known.
   *
   * REQUIRED, because the only caller is the vendor portal — a vendor does not
   * choose which vendor it is. Passing it replaces the vendor select with a
   * read-only field and skips `useVendorOptions()` entirely: that endpoint is
   * gated on `masters.view` and, for a staff caller, lists every vendor in the
   * company. A vendor must neither need it nor see its result.
   */
  vendor: Pick<VendorOption, "id" | "name">;
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
  /**
   * The company has no credits left for another ticket. The page says why
   * above the form; this only stops a submit the server would refuse.
   */
  paused?: boolean;
}

export function ManualEntryForm({
  onSubmit,
  onCancel,
  isSubmitting,
  vendor,
  addressSearch,
  paused = false,
}: ManualEntryFormProps) {

  const {
    control,
    register,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors, isSubmitted },
  } = useForm<TicketFormValues>({
    resolver: zodResolver(ticketSchema),
    defaultValues: {
      vendorId: vendor.id,
      subcategoryId: "",
      modelId: "",
      serviceType: "Installation + Demo",
      isHighPriority: false,
      purchaseMode: "offline",
      purchasePlatformId: "",
      // E1 — read two ways depending on `purchaseMode`: the offline free-text
      // store name, or the online "Others" platform name. See `platformChoice`
      // below for the UI state that decides which.
      purchasePlatformName: "",
      description: "",
      serialNumber: "",
      customerName: "",
      customerPhone: "",
      customerAltPhone: "",
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
   * Every value this form writes ITSELF goes through here, never bare `setValue`.
   *
   * After a submit, RHF re-validates a field as it changes — but only a change
   * that arrives through a registered input or a controller. `setValue`
   * validates only when told to, so the errors the submit put on the address,
   * the pincode and the category never cleared: QA's pincode read 500018 above
   * "Pincode must be 6 digits". Validating once the form has been submitted is
   * the rule `reValidateMode` already applies to the typed fields — quiet while
   * somebody fills it in, live once they have been told what is wrong.
   */
  const write = useCallback<UseFormSetValue<TicketFormValues>>(
    (name, value, options) =>
      setValue(name, value, { ...options, shouldValidate: isSubmitted }),
    [setValue, isSubmitted]
  );

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

  /**
   * A3 — the drill-down's answer to a QUESTION above it: which brand. Local
   * for the same reason `picked` is: it is how somebody reached the
   * product, not part of the ticket — `modelId` is already enough for the
   * API to know the brand, so nothing here is submitted on its own.
   */
  const [brandId, setBrandId] = useState<string>("");

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
  // A7 — the platform box only appears, and only matters, while this reads
  // "online"; see `clearPurchasePlatform` beside `purchasePlatforms` below,
  // run from the mode radio's own `onValueChange`.
  const purchaseMode = useWatch({ control, name: "purchaseMode" });

  /**
   * E1 — which option the Platform select is showing right now: a real
   * platform's id, `OTHERS_PLATFORM`, or `""` while nothing has been picked
   * yet. Local, same reasoning as `picked`/`brandId` above: it is how the
   * UI reached its answer, not the answer — the answer is whichever of
   * `purchasePlatformId` / `purchasePlatformName` actually ends up in RHF.
   */
  const [platformChoice, setPlatformChoice] = useState<string>("");

  /* A7 — every ACTIVE platform this company has. Short and rarely changing,
     like the vendor list this form used to need, so it is fetched
     unconditionally rather than only once the vendor has gone online — a
     vendor flips back and forth while filling the form, and refetching on
     every flip would mean the picker blanking each time. */
  const { data: purchasePlatforms, isPending: platformsPending } =
    usePurchasePlatforms();
  // The service already asks for `activeOnly=true`, so nothing here filters
  // — it only reshapes `{id, name}` into the `{value, label}` every other
  // select in this form stores.
  const purchasePlatformOptions: Option[] = (purchasePlatforms ?? []).map(
    (p) => ({ value: p.id, label: p.name })
  );
  // E1 — "Others" is always on the list, even while it is the only thing on
  // it: a company with nothing seeded yet (or a slow first fetch) still has
  // somewhere to type a platform name, rather than a box with nothing to
  // choose from.
  const platformSelectOptions: Option[] = [
    ...purchasePlatformOptions,
    { value: OTHERS_PLATFORM, label: "Others" },
  ];

  /* A value chosen while online is stale the moment the mode flips — in
     EITHER direction. Flipping to offline leaves a chosen platform id (or
     an "Others" name) behind a box that no longer exists; flipping TO
     online must not quietly inherit the offline box's free text as though
     it had been typed as an "Others" platform name. Both directions are
     handled the same way: everything the box could have written is
     cleared, and the select resets to "nothing chosen yet".
     Done in the mode radio's OWN `onValueChange` below, not in an effect —
     the flip is a single user action, and clearing what it invalidates
     belongs beside the action that caused it rather than in a `useEffect`
     that would otherwise be setting state synchronously from inside
     itself. */
  const clearPurchasePlatform = useCallback(() => {
    write("purchasePlatformId", "");
    write("purchasePlatformName", "");
    setPlatformChoice("");
  }, [write]);

  /* The address is one control over four form fields, so it is watched and
     written rather than registered — through `write`, or its errors would
     outlive the values that fix them. `AddressFields` owns the Google lookup
     and the check against the geography master; the form owns the values. */
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
      write("address", next.address, { shouldDirty: true });
      write("city", next.city, { shouldDirty: true });
      write("state", next.state, { shouldDirty: true });
      write("pincode", next.pincode, { shouldDirty: true });
      // Set together with the address they describe, and nulled by
      // `AddressFields` the moment one of the boxes above is hand-edited — a
      // point that has stopped matching its address is worse than no point,
      // because the server enforces it against the technician who turns up.
      write("latitude", next.latitude ?? null, { shouldDirty: true });
      write("longitude", next.longitude ?? null, { shouldDirty: true });
    },
    [write]
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
     raised against a specific vendor's product, so the categories on offer are
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

  /**
   * A3/A4 — Vendor → Brand → Category → Sub-category, the brand sitting
   * ABOVE the drill-down rather than inside it. Built from the FULL tree,
   * never the brand-pruned one below: this is the list the select itself
   * offers, so it must not already depend on which brand (if any) is
   * chosen. Every brand here leads somewhere real — the intake tree the
   * server sends has already dropped every branch holding none of this
   * vendor's products, so a brand present in it is a brand with at least
   * one priced model under it.
   */
  const brandOptions = vendorBrands(tree);
  // Whether a model's name needs its brand in front — see `modelLabel`. This
  // is the vendor's WHOLE catalogue, not the chosen brand: the serial lookup
  // below can offer a match from any brand, and the confirmed/conflicting
  // messages have to call it what the suggestion list already called it.
  const severalBrands = brandOptions.length > 1;

  function pickBrand(id: string) {
    setBrandId(id);
    // Truncate exactly like `pickLevel` does on a changed category: a box
    // answered under the OLD brand is not an answer under the new one, and
    // leaving it set would submit a model that this brand's pruned tree no
    // longer offers.
    setPicked([]);
    write("subcategoryId", "");
    write("modelId", "");
    write("serviceType", "Installation + Demo");
  }

  // A single brand fills itself — hard rule 10, same as any other computed
  // select here. Runs regardless of whether the control below is actually
  // mounted (it is hidden in exactly this case), which is why this is its
  // own call rather than relying on `SelectShell`'s identical internal one.
  useAutoSelectSingle(
    brandOptions.map((o) => o.value),
    brandId,
    pickBrand,
    Boolean(vendorId) && !treePending
  );

  /* The drill-down and the model list read THIS, never `tree` directly —
     pruned to the chosen brand so a sub-category or a model carrying none
     of its products disappears rather than dead-ending, the same pruning
     the server already does for the vendor as a whole (see the note above
     `useNodeTree`). Empty rather than the unfiltered tree while no brand is
     chosen yet: the drill-down is DISABLED in that state and must not show
     the whole catalogue behind it. */
  const brandTree = pruneTreeForBrand(tree, brandId);

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
  const chain = resolveChain(brandTree, picked);
  const levels: { parentId: string; options: ProductNode[]; value: string }[] = [];
  {
    let pool: ProductNode[] = brandTree;
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
    write("subcategoryId", node?.isLeaf ? id : "");
    write("modelId", "");
    write("serviceType", "Installation + Demo");
  }

  // `chosen.models` is already pruned to the selected brand — every option
  // here carries it, so prefixing the name with it the way `modelLabel` does
  // for the SERIAL suggestions (which span every brand at once) would only
  // repeat what the Brand select above already said.
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
  /* What `matches` is a result FOR, and whether the server has more of it.
     Both are needed to page: the scroll handler has to ask for the same term
     the list was built from, not whatever is in the box by the time it fires. */
  const [searchedFor, setSearchedFor] = useState("");
  const [hasMore, setHasMore] = useState(false);

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
      write("subcategoryId", hit.nodeId);
      write("modelId", hit.modelId);
      write("serviceType", hit.serviceTypes[0] ?? "Installation + Demo");
      // Normalisation, never a content change: the match was EXACT, so this can
      // differ only in case or surrounding space. Worth doing — the ticket would
      // otherwise print a serial the master spells differently.
      write("serialNumber", hit.serial);
      // A3 — the serial may belong to a brand other than the one currently
      // selected. `setPicked`/`setBrandId` land in the same render (React
      // batches both), so the brand-pruned tree the drill-down reads next
      // already contains the node this just filled in, rather than pruning
      // it straight back out from under the match.
      const brand = findModelBrand(tree, hit.modelId);
      if (brand) setBrandId(brand);
    },
    [tree, write]
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
    onSuccess: (found, serial) => {
      setMatches(found);
      setActiveIndex(-1);
      setSearchedFor(serial);
      // A full page might have more behind it; a short one is the end. No total
      // is fetched, because counting would be a second query to answer a
      // question one comparison already answers.
      setHasMore(found.length === SERIAL_PAGE_SIZE);
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
      setHasMore(false);
    },
  });

  /* The next page, appended. Its own mutation rather than a flag on the one
     above, because the two do different things to the list: that one REPLACES
     it and may autofill from it, this one only ever adds to the end and must
     never re-trigger a fill. */
  const loadMore = useMutation({
    mutationFn: ({ term, offset }: { term: string; offset: number }) =>
      lookupSerial(term, { offset }),
    onSuccess: (found, { term }) => {
      // The box may have moved on while this was in flight. Appending a page
      // of a stale search would put rows under a query that never asked for
      // them, so it is dropped.
      if (term !== searchedFor) return;
      setMatches((prev) => [...prev, ...found]);
      setHasMore(found.length === SERIAL_PAGE_SIZE);
    },
    onError: () => setHasMore(false),
  });

  function onSuggestScroll(e: React.UIEvent<HTMLUListElement>) {
    if (!hasMore || loadMore.isPending) return;
    const el = e.currentTarget;
    // Fetched a little before the end, so the next rows are usually already
    // there by the time the reader arrives at them — the same lead
    // `shared/LoadMore` takes with its IntersectionObserver.
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 80) return;
    loadMore.mutate({ term: searchedFor, offset: matches.length });
  }

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
        setHasMore(false);
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
  /** The selected model IS one of the serial's products — whether the form
   *  filled it or the user picked it by hand. Worth confirming either way: it
   *  tells the vendor the number will survive intake. One of several counts:
   *  a serial may legally sit on two products, and the API accepts either. */
  const confirmed = modelId
    ? exactMatches.find((m) => m.modelId === modelId)
    : undefined;
  /** The serial is on record, but only for products OTHER than the one
   *  selected. `_assert_serial_known` refuses that (`SERIAL_ON_OTHER_PRODUCT`)
   *  even when the selected model has no serials loaded — "unchecked" means
   *  "cannot say", and the master can say. QA raised a washing machine's
   *  serial against a switch board under this very notice because the button
   *  still worked; it now waits until the two agree, by taking the offer below
   *  or by changing the serial. */
  const serialOnOtherProduct =
    Boolean(modelId) && !confirmed && exactMatches.length > 0;
  /** The one other product, offered by name. An offer, never a silent switch. */
  const conflicting =
    serialOnOtherProduct && exactMatches.length === 1
      ? exactMatches[0]
      : undefined;

  /* ── will `_assert_serial_known` refuse this at submit? ───────────────────
     Zero serials on the chosen model means UNCHECKED — anything is accepted,
     and that has to stay true here too (the whole point of "unchecked" is a
     company can load one model's serials without breaking every other
     vendor's intake). Once the model HAS serials, though, silence is the
     wrong answer: `confirmed` is the only shape the API will accept, so
     `conflicting`, "several products" and no match at all are three ways of
     saying the same thing — this exact number will not survive submit. */
  const serialChecked = (model?.serialCount ?? 0) > 0;
  /* Read against what the lookup actually finished searching for, not what is
     in the box right now — a keystroke fired inside the 300ms debounce, or a
     reply still in flight, must not read as "definitely no match". */
  const serialLookupSettled =
    !lookup.isPending && searchedFor.trim().toLowerCase() === typedSerial;
  const serialWillBeRefused =
    serialChecked && typedSerial.length > 0 && serialLookupSettled && !confirmed;
  /** Either serial refusal. Named because the button and its reason share it. */
  const serialBlocked = serialWillBeRefused || serialOnOtherProduct;

  const err = (name: keyof TicketFormValues) => errors[name]?.message;

  function submit(values: TicketFormValues) {
    // The button is disabled in this state, but a form can still be submitted
    // by keyboard while a check is in flight.
    if (addressBlocked || paused || serialBlocked) return;
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
      // A6 — empty means "not given", which the server stores as null, the
      // same treatment `description` gets above. Never an empty string, so
      // "no second number" and "blank" cannot diverge.
      customerAltPhone: values.customerAltPhone?.trim() || undefined,
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
      // A2.
      isHighPriority: values.isHighPriority,
      // A7/E1 — `purchasePlatformId` travels only with "online", and only
      // when a REAL platform (not the "Others" sentinel, which never
      // reaches RHF in the first place) was chosen. The clearing effect
      // above already empties it the moment the mode flips, but submit is
      // where a stray value would actually reach the API, so the omission
      // is re-asserted here rather than trusted from state alone.
      purchaseMode: values.purchaseMode,
      purchasePlatformId:
        values.purchaseMode === "online" && values.purchasePlatformId
          ? values.purchasePlatformId
          : undefined,
      // E1 — the one free-text field, read two ways: the offline store name
      // the vendor typed, or the online "Others" name — but only while NO
      // real platform id is also going out, so a stray value here can never
      // contradict the id above. Trimmed again, defensively, like every
      // other optional text on this submit; empty means "nothing typed",
      // never an empty string sent to the API.
      purchasePlatformName:
        values.purchaseMode === "offline" ||
        (values.purchaseMode === "online" && !values.purchasePlatformId)
          ? values.purchasePlatformName?.trim() || undefined
          : undefined,
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
                    onScroll={onSuggestScroll}
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
                          {modelLabel(hit.modelName, hit.brandName, severalBrands)}{" "}
                          · {hit.nodePath.join(" › ")}
                        </span>
                      </li>
                    ))}
                    {/* `aria-hidden` and not an option: it is a status, and a
                        screen reader walking the list must not land on a row
                        that cannot be chosen. */}
                    {hasMore ? (
                      <li
                        aria-hidden
                        className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-ink-3"
                      >
                        {loadMore.isPending ? (
                          <>
                            <Spinner />
                            Loading more…
                          </>
                        ) : (
                          "Scroll for more"
                        )}
                      </li>
                    ) : null}
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
                               serial the typo. Submit waits until they agree —
                               the API refuses the pair, so red, not amber
                  several      two products carry the number, so the form asks
                               (and, once a model is chosen, waits likewise)
                Silence otherwise, including on no match — most serials are not
                loaded, and that is not a failure worth a line of text. */}
            {confirmed ? (
              <FieldDescription className="text-ok">
                Matches {confirmed.nodePath.join(" › ")} ›{" "}
                {modelLabel(confirmed.modelName, confirmed.brandName, severalBrands)}.
              </FieldDescription>
            ) : conflicting ? (
              <FieldDescription className="flex flex-wrap items-center gap-2 text-danger">
                {/* With the brand where the vendor sells several: two brands may
                    each have a "43 inch LED" here, and without it this sentence
                    could name the very model already selected. */}
                <span>
                  This serial belongs to{" "}
                  {modelLabel(conflicting.modelName, conflicting.brandName, severalBrands)},
                  not the model selected below. Switch to it, or correct the
                  serial, to raise this ticket.
                </span>
                {/* `text-ink`: `outline` sets no colour of its own, so it would
                    inherit the red above and read as a destructive action. */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-ink"
                  onClick={() => applyMatch(conflicting)}
                >
                  Use {modelLabel(conflicting.modelName, conflicting.brandName, severalBrands)}
                </Button>
              </FieldDescription>
            ) : exactMatches.length > 1 ? (
              <FieldDescription
                className={serialOnOtherProduct ? "text-danger" : "text-warn"}
              >
                {exactMatches.length} products carry this exact serial — pick
                one from the list, or set the category and model below.
              </FieldDescription>
            ) : serialWillBeRefused ? (
              // The chosen model DOES have serials loaded and none of them is
              // this one — `_assert_serial_known` will refuse it, so say so
              // now rather than after the rest of the form is filled in.
              <FieldDescription className="text-danger">
                {serialNumber?.trim()} is not a serial number on record for{" "}
                {model?.name}. Check it against the invoice, or ask for it to
                be added to the product master.
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

            {/* A3 — Brand, ABOVE the drill-down. Vendor → Brand → Category →
                Sub-category is the order asked for; the serial box above
                keeps its own first position (an explicit call — it is the
                vendor's real starting point, see the comment up top), so
                this sits between the serial's notices and the categories it
                now scopes. Hidden when the vendor sells only one brand —
                picked for them, `useAutoSelectSingle` above, the same as any
                other single-option list (hard rule 10). */}
            {severalBrands ? (
              <FieldGrid className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <SelectShell
                  id="field-brand"
                  label="Brand"
                  required
                  placeholder={
                    !vendorId
                      ? "Pick a vendor first"
                      : vendorHasNothing
                        ? `${vendorName} has nothing approved yet`
                        : "Select brand"
                  }
                  groups={[{ options: brandOptions }]}
                  value={brandId}
                  onChange={pickBrand}
                  disabled={!vendorId || vendorHasNothing}
                />
              </FieldGrid>
            ) : null}

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
                          : !brandId
                            ? "Pick a brand first"
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
                  disabled={!vendorId || vendorHasNothing || !brandId}
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
                onChanged={() => write("serviceType", "Installation + Demo")}
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

          {/* A7 — where the unit was bought. Its own small section rather
              than folded into "Vendor & product" above: it is a fact about
              the SALE, not about which product was chosen, and rather than
              "Customer" below: the customer did not buy it FROM us, so it
              sits between the two instead of inside either. */}
          <FormSection legend="Purchase">
            <Controller
              name="purchaseMode"
              control={control}
              render={({ field }) => (
                <RadioGroup
                  value={field.value}
                  onValueChange={(v) => {
                    field.onChange(v as PurchaseMode);
                    clearPurchasePlatform();
                  }}
                  className="grid gap-3 sm:grid-cols-2"
                >
                  {PURCHASE_MODE_OPTIONS.map((o) => (
                    <label
                      key={o.value}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-md border px-3.5 py-3 transition-colors",
                        field.value === o.value
                          ? "border-brand-500 bg-brand-100/40"
                          : "border-line hover:border-brand-400"
                      )}
                    >
                      <RadioGroupItem value={o.value} />
                      <span className="text-[13px] font-semibold">
                        {o.title}
                      </span>
                    </label>
                  ))}
                </RadioGroup>
              )}
            />

            {/* E1 — offline is a free-text box, not a picker: there is no
                company master of physical shops to choose from, only the
                vendor's own words for where it was bought. */}
            {purchaseMode === "offline" ? (
              <TextField
                name="purchasePlatformName"
                label="Where was it bought?"
                placeholder="Local electronics shop, name of the store…"
                register={register}
                error={err("purchasePlatformName")}
              />
            ) : null}

            {/* Only ever an offer — the server accepts "online, platform
                unspecified". "Others" is always on the list (see
                `platformSelectOptions`), so there is always something to
                choose even before this company has configured a single
                platform. Platform creation itself lives on an admin
                screen, not here — this form is vendor-only. */}
            {purchaseMode === "online" ? (
              <>
                <SelectShell
                  id="field-purchasePlatformChoice"
                  label="Platform"
                  placeholder={
                    platformsPending ? "Loading platforms…" : "Select a platform"
                  }
                  groups={[{ options: platformSelectOptions }]}
                  value={platformChoice}
                  onChange={(next) => {
                    setPlatformChoice(next);
                    if (next === OTHERS_PLATFORM) {
                      // Nothing on the list fit — the id is not a real
                      // platform's, so it must never reach the API as one.
                      write("purchasePlatformId", "");
                    } else {
                      // A real platform: the id is the whole answer, and any
                      // "Others" text left over from a previous choice is
                      // no longer what this box means.
                      write("purchasePlatformId", next);
                      write("purchasePlatformName", "");
                    }
                  }}
                  disabled={platformsPending}
                  error={err("purchasePlatformId")}
                />
                {platformChoice === OTHERS_PLATFORM ? (
                  <TextField
                    name="purchasePlatformName"
                    label="Platform name"
                    placeholder="e.g. a site not listed above"
                    register={register}
                    error={err("purchasePlatformName")}
                  />
                ) : null}
              </>
            ) : null}
          </FormSection>

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
              {/* A6 — a second number for the same customer: a relative, a
                  shop, whoever else can let the technician in. Same input
                  treatment and the same phone rule as the box above, minus
                  the requirement. */}
              <TextField
                name="customerAltPhone"
                label="Alternate mobile number"
                placeholder="+91 "
                inputMode="tel"
                autoComplete="tel"
                register={register}
                error={err("customerAltPhone")}
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

            {/* A2 — a flag for the board, not a rule: see `Ticket.isHighPriority`.
                One line, here rather than a section of its own, because
                there is nothing else to ask once this is ticked — no SLA
                changes, nothing a technician's eligibility reads. */}
            <Field orientation="horizontal">
              <Controller
                name="isHighPriority"
                control={control}
                render={({ field }) => (
                  <Checkbox
                    id="field-is-high-priority"
                    checked={field.value}
                    onCheckedChange={(next) => field.onChange(next === true)}
                  />
                )}
              />
              <div>
                <FieldLabel htmlFor="field-is-high-priority" className="font-normal">
                  Flag as high priority
                </FieldLabel>
                <FieldDescription>
                  Shown on the board. Does not change the SLA or who can take it.
                </FieldDescription>
              </div>
            </Field>
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
        {/* Why the button is dead, said where the pointer is. The serial notice
            that explains it sits at the top of a long form, out of sight by the
            time anybody reaches this button. */}
        {serialBlocked ? (
          <p
            id="submit-blocked-reason"
            className="mr-auto self-center text-xs text-danger"
          >
            The serial number and the product do not match — see Serial number
            above.
          </p>
        ) : null}
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isSubmitting || addressBlocked || paused || serialBlocked}
          aria-describedby={serialBlocked ? "submit-blocked-reason" : undefined}
        >
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
 * A3 — every brand this vendor's intake tree carries a product under, as
 * `{ value, label }` for the Brand select: id first, because that is what
 * every other option in this form stores, the name second for the reader.
 * The first model found under a brand names it, so a renamed brand still
 * reads consistently across one tree.
 */
function vendorBrands(nodes: ProductNode[] | undefined): Option[] {
  const names = new Map<string, string>();
  const walk = (node: ProductNode) => {
    for (const m of node.models) {
      if (!names.has(m.brandId)) names.set(m.brandId, m.brandName);
    }
    node.children.forEach(walk);
  };
  (nodes ?? []).forEach(walk);
  return [...names.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * A3 — the brand a given model sits under, anywhere in the tree. What
 * `applyMatch` reads to keep the brand-scoped drill-down in step with a
 * serial hit that may belong to a brand other than the one selected —
 * `SerialMatch` itself carries a brand NAME, not an id, and a name is not
 * what the Brand select stores.
 */
function findModelBrand(
  nodes: ProductNode[] | undefined,
  modelId: string
): string | undefined {
  for (const node of nodes ?? []) {
    const match = node.models.find((m) => m.id === modelId);
    if (match) return match.brandId;
    const deeper = findModelBrand(node.children, modelId);
    if (deeper) return deeper;
  }
  return undefined;
}

/**
 * A3 — the tree, narrowed to one brand's products. `resolveChain` and the
 * model list both walk this instead of the full tree once a brand is
 * chosen, so a branch holding none of that brand's products disappears
 * rather than dead-ending — the same pruning the server already does for
 * the vendor as a whole (see the note above `useNodeTree`).
 *
 * Empty, not the unfiltered tree, while no brand is chosen: the drill-down
 * is DISABLED in that state (see the `disabled` prop below it) and must
 * never show the whole catalogue sitting behind a control nobody can use
 * yet.
 */
function pruneTreeForBrand(
  nodes: ProductNode[] | undefined,
  brandId: string
): ProductNode[] {
  if (!brandId) return [];
  const prune = (list: ProductNode[]): ProductNode[] =>
    list
      .map((node) => ({
        ...node,
        children: prune(node.children),
        models: node.models.filter((m) => m.brandId === brandId),
      }))
      .filter((node) =>
        node.isLeaf ? node.models.length > 0 : node.children.length > 0
      );
  return prune(nodes ?? []);
}

/**
 * A model's name as this form says it: with its brand in front only where
 * that tells two apart — the vendor sells more than one brand — and only when
 * the name does not already start with it, which the seeded names mostly do
 * ("Meridian 43"…"). A vendor selling under one brand sees plain names.
 *
 * Tolerates a missing brand, so a reply from an API older than the field reads
 * as the bare name rather than throwing. The technician's job card says it the
 * same way — `model_label` in `api/app/core/product_label.py`; keep them in step.
 */
function modelLabel(name: string, brandName: string | undefined, several: boolean) {
  if (!several || !brandName) return name;
  return name.toLowerCase().startsWith(brandName.toLowerCase())
    ? name
    : `${brandName} · ${name}`;
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
