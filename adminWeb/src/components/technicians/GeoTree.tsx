import * as React from "react";
import {
  ChevronRightIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCoverageTree,
  useDistrictPincodes,
  useExpandCoverage,
} from "@/hooks/useGeo";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { cn } from "@/lib/utils";
import type {
  CoverageTreeDistrict,
  CoverageTreeState,
} from "@/types/geo";
import {
  MAX_COVERAGE_PINCODES,
  addCodes,
  matchesName,
  nextNodeChecked,
  nodeState,
  overBy,
  removeCodes,
  selectionKey,
  toggleCode,
  type NodeState,
} from "./geoTreeMath";

/**
 * The picker lays states, districts and pincodes out as columns, opening a
 * node drops a full-width tinted panel under its row (dense flow lets the
 * siblings after it fill the row above, so the panel always sits right under
 * the row its parent is in).
 */
const GRID =
  "grid grid-cols-2 gap-x-2 gap-y-0.5 [grid-auto-flow:row_dense] sm:grid-cols-3 lg:grid-cols-4";

/** Chips shown before the rest hide behind "Show all". */
const CHIP_PREVIEW = 20;

/**
 * Epic 2 — the coverage picker: States → Districts → Pincodes as a tri-state
 * checkbox tree, inside the region the caller already chose.
 *
 * The SELECTION is the parent's flat `value` (6-digit codes) and nothing else;
 * the tree keeps no copy. A node's box is derived from the counts
 * `POST /geo/tree` returns for the current selection — re-asked (debounced)
 * whenever it changes — so a saved coverage opens correctly ticked and
 * half-ticked. Ticking a state or district asks `/geo/expand` for its codes and
 * adds them; un-ticking removes the same codes. Pincodes of a district are only
 * fetched once it is opened.
 *
 * Everything the caller may not pick is already absent: the server scopes all
 * three reads to their territory (and `franchiseeId`, which staff pass for the
 * franchisee whose coverage they edit — a franchise principal's is forced).
 */
export function GeoTree({
  regionId,
  value,
  onChange,
  franchiseeId,
  id,
  invalid,
  describedBy,
}: {
  regionId: string;
  value: string[];
  onChange: (next: string[]) => void;
  franchiseeId?: string;
  id?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [query, setQuery] = React.useState("");
  const [openStates, setOpenStates] = React.useState<Set<string>>(new Set());
  const [openDistricts, setOpenDistricts] = React.useState<Set<string>>(
    new Set()
  );
  const [activeKey, setActiveKey] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [showAll, setShowAll] = React.useState(false);
  const treeRef = React.useRef<HTMLUListElement>(null);

  // The latest selection, for handlers that await the server and must not
  // write back a list that changed while they waited.
  const valueRef = React.useRef(value);
  React.useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const key = useDebouncedValue(selectionKey(value), 300);
  const tree = useCoverageTree(regionId, key, franchiseeId);
  const expand = useExpandCoverage();

  const count = value.length;
  const over = overBy(count);

  const apply = (r: ReturnType<typeof addCodes>) => {
    if (r.overLimit) {
      setNotice(
        `That would make ${r.wouldBe.toLocaleString()} pincodes. A technician can cover up to ${MAX_COVERAGE_PINCODES}.`
      );
      return;
    }
    setNotice(null);
    onChange(r.next);
  };

  /** Tick or un-tick a whole state or district. */
  const toggleNode = async (
    kind: "state" | "district",
    nodeId: string,
    checked: boolean
  ) => {
    try {
      const out = await expand.mutateAsync({
        stateIds: kind === "state" ? [nodeId] : [],
        districtIds: kind === "district" ? [nodeId] : [],
        ...(franchiseeId ? { franchiseeId } : {}),
      });
      if (checked) {
        apply(addCodes(valueRef.current, out.pincodes));
      } else {
        setNotice(null);
        onChange(removeCodes(valueRef.current, out.pincodes));
      }
    } catch (err) {
      // The 422 past 5,000 carries a readable sentence; the selection stays.
      setNotice(
        err instanceof Error && err.message
          ? err.message
          : "Could not load those pincodes. Try again."
      );
    }
  };

  const toggleOpen = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    nodeId: string
  ) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
    // A collapsed branch may have held the tab stop.
    setActiveKey(null);
  };

  const states = React.useMemo(() => {
    const all = tree.data?.states ?? [];
    if (!query.trim()) {
      return all.map((s) => ({ state: s, districts: s.districts, forced: false }));
    }
    return all
      .map((s) => {
        if (matchesName(s.name, query)) {
          return { state: s, districts: s.districts, forced: false };
        }
        const districts = s.districts.filter((d) => matchesName(d.name, query));
        return { state: s, districts, forced: true };
      })
      .filter((row) => row.forced ? row.districts.length > 0 : true);
  }, [tree.data, query]);

  const onTreeKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>(
      '[role="treeitem"]'
    );
    // Only the focused item itself — a key pressed in a child control is its own.
    if (!item || e.target !== item) return;
    const items = Array.from(
      treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []
    );
    const at = items.indexOf(item);
    const go = (el?: HTMLElement) => {
      if (el) {
        e.preventDefault();
        el.focus();
      }
    };
    const expanded = item.getAttribute("aria-expanded");
    const row = item.querySelector<HTMLElement>(":scope > [data-row]");
    switch (e.key) {
      case "ArrowDown":
        return go(items[at + 1]);
      case "ArrowUp":
        return go(items[at - 1]);
      case "Home":
        return go(items[0]);
      case "End":
        return go(items[items.length - 1]);
      case "ArrowRight":
        if (expanded === "false") {
          e.preventDefault();
          row?.querySelector<HTMLElement>("[data-chevron]")?.click();
        } else if (expanded === "true") {
          go(items[at + 1]);
        }
        return;
      case "ArrowLeft":
        if (expanded === "true") {
          e.preventDefault();
          row?.querySelector<HTMLElement>("[data-chevron]")?.click();
        } else {
          go(
            item.parentElement?.closest<HTMLElement>('[role="treeitem"]') ??
              undefined
          );
        }
        return;
      case " ":
        e.preventDefault();
        row?.querySelector<HTMLElement>('[role="checkbox"]')?.click();
        return;
      case "Enter":
        if (expanded !== null) {
          e.preventDefault();
          row?.querySelector<HTMLElement>("[data-chevron]")?.click();
        } else {
          e.preventDefault();
          row?.querySelector<HTMLElement>('[role="checkbox"]')?.click();
        }
        return;
    }
  };

  if (!regionId) {
    return (
      <div
        id={id}
        className="rounded-lg border border-dashed border-line bg-surface-2 px-3 py-6 text-center text-sm text-ink-3"
      >
        Choose a region first
      </div>
    );
  }

  const firstKey = states.length ? `s:${states[0].state.id}` : null;
  const tabStop = activeKey ?? firstKey;
  const busy = expand.isPending;

  return (
    <div
      id={id}
      className="grid gap-2"
      aria-describedby={describedBy}
      aria-invalid={invalid ? true : undefined}
    >
      <div className="relative">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3"
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveKey(null);
          }}
          placeholder="Search a state or district"
          aria-label="Search a state or district"
          className="pl-8"
        />
      </div>

      <div
        className={cn(
          "max-h-96 overflow-auto rounded-lg border bg-background p-2",
          invalid ? "border-danger" : "border-line"
        )}
        aria-busy={tree.isFetching || busy ? true : undefined}
      >
        {tree.isPending ? (
          <div className="grid gap-2 p-2" role="status" aria-label="Loading">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : tree.isError ? (
          <div role="alert" className="grid justify-items-start gap-2 p-3">
            <p className="text-sm text-danger">
              Could not load the states for this region.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void tree.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : (tree.data?.states.length ?? 0) === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-ink-3">
            Nothing to pick in this region
          </p>
        ) : states.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-ink-3">
            No state or district matches that
          </p>
        ) : (
          <ul
            ref={treeRef}
            role="tree"
            aria-label="States and districts"
            aria-multiselectable="true"
            onKeyDown={onTreeKeyDown}
            className={GRID}
          >
            {states.map(({ state, districts, forced }) => (
              <StateNode
                key={state.id}
                state={state}
                districts={districts}
                open={forced || openStates.has(state.id)}
                forced={forced}
                openDistricts={openDistricts}
                value={value}
                franchiseeId={franchiseeId}
                busy={busy}
                tabStop={tabStop}
                onActive={setActiveKey}
                onToggleOpen={() => toggleOpen(setOpenStates, state.id)}
                onToggleDistrictOpen={(d) => toggleOpen(setOpenDistricts, d)}
                onToggleNode={toggleNode}
                onToggleCode={(code) => apply(toggleCode(valueRef.current, code))}
              />
            ))}
          </ul>
        )}
      </div>

      {notice ? (
        <p role="alert" className="text-sm text-danger">
          {notice}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          className={cn("text-sm", over > 0 ? "text-danger" : "text-ink-2")}
          aria-live="polite"
        >
          {count === 1
            ? `1 pincode selected (max ${MAX_COVERAGE_PINCODES})`
            : `${count.toLocaleString()} pincodes selected (max ${MAX_COVERAGE_PINCODES})`}
          {over > 0
            ? ` — ${over} over the limit. Untick some to continue.`
            : null}
        </p>
        {count > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setNotice(null);
              onChange([]);
            }}
          >
            Clear all
          </Button>
        ) : null}
      </div>

      {count > 0 ? (
        <div className="grid justify-items-start gap-1.5">
          <ul
            aria-label="Selected pincodes"
            className={cn(
              "flex flex-wrap gap-1",
              showAll && count > CHIP_PREVIEW && "max-h-40 overflow-auto"
            )}
          >
            {(showAll ? value : value.slice(0, CHIP_PREVIEW)).map((code) => (
              <li
                key={code}
                className="inline-flex items-center gap-1 rounded-md bg-surface-3 py-0.5 pr-0.5 pl-2 text-xs font-medium text-ink-2"
              >
                {code}
                <button
                  type="button"
                  aria-label={`Remove ${code}`}
                  onClick={() => onChange(removeCodes(valueRef.current, [code]))}
                  className="grid size-4 place-items-center rounded text-ink-3 transition-colors hover:text-danger"
                >
                  <XIcon aria-hidden className="size-3" />
                </button>
              </li>
            ))}
          </ul>
          {count > CHIP_PREVIEW ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? "Show fewer" : `Show all ${count.toLocaleString()}`}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ── rows ─────────────────────────────────────────────────────────────────── */

function boxState(selected: number, total: number): NodeState {
  return nodeState(selected, total);
}

function StateNode({
  state,
  districts,
  open,
  forced,
  openDistricts,
  value,
  franchiseeId,
  busy,
  tabStop,
  onActive,
  onToggleOpen,
  onToggleDistrictOpen,
  onToggleNode,
  onToggleCode,
}: {
  state: CoverageTreeState;
  districts: CoverageTreeDistrict[];
  open: boolean;
  forced: boolean;
  openDistricts: Set<string>;
  value: string[];
  franchiseeId?: string;
  busy: boolean;
  tabStop: string | null;
  onActive: (key: string) => void;
  onToggleOpen: () => void;
  onToggleDistrictOpen: (districtId: string) => void;
  onToggleNode: (
    kind: "state" | "district",
    id: string,
    checked: boolean
  ) => void;
  onToggleCode: (code: string) => void;
}) {
  const st = boxState(state.selectedCount, state.pincodeCount);
  const itemKey = `s:${state.id}`;
  return (
    <TreeItem
      itemKey={itemKey}
      level={1}
      label={state.name}
      detail={state.selectedCount > 0 ? state.selectedCount : undefined}
      state={st}
      open={state.districts.length ? open : undefined}
      // A search that matched only districts holds the state open itself.
      lockOpen={forced}
      disabled={busy || state.pincodeCount === 0}
      tabStop={tabStop === itemKey}
      onActive={onActive}
      onToggleOpen={onToggleOpen}
      onToggleCheck={() => onToggleNode("state", state.id, nextNodeChecked(st))}
    >
      {open && districts.length ? (
        <ul
          role="group"
          className={cn(GRID, "col-span-full my-1 rounded-md bg-surface-2 p-2")}
        >
          {districts.map((d) => {
            const ds = boxState(d.selectedCount, d.pincodeCount);
            const dKey = `d:${d.id}`;
            const dOpen = openDistricts.has(d.id);
            return (
              <TreeItem
                key={d.id}
                itemKey={dKey}
                level={2}
                label={d.name}
                detail={d.selectedCount > 0 ? d.selectedCount : undefined}
                state={ds}
                open={d.pincodeCount > 0 ? dOpen : undefined}
                disabled={busy || d.pincodeCount === 0}
                tabStop={tabStop === dKey}
                onActive={onActive}
                onToggleOpen={() => onToggleDistrictOpen(d.id)}
                onToggleCheck={() =>
                  onToggleNode("district", d.id, nextNodeChecked(ds))
                }
              >
                {dOpen ? (
                  <DistrictPincodes
                    districtId={d.id}
                    franchiseeId={franchiseeId}
                    value={value}
                    tabStop={tabStop}
                    onActive={onActive}
                    onToggleCode={onToggleCode}
                  />
                ) : null}
              </TreeItem>
            );
          })}
        </ul>
      ) : null}
    </TreeItem>
  );
}

function DistrictPincodes({
  districtId,
  franchiseeId,
  value,
  tabStop,
  onActive,
  onToggleCode,
}: {
  districtId: string;
  franchiseeId?: string;
  value: string[];
  tabStop: string | null;
  onActive: (key: string) => void;
  onToggleCode: (code: string) => void;
}) {
  const q = useDistrictPincodes(districtId, true, franchiseeId);
  const picked = React.useMemo(() => new Set(value), [value]);

  if (q.isPending) {
    return (
      <div className="col-span-full grid gap-1.5 py-1" role="status" aria-label="Loading">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-5 w-32" />
      </div>
    );
  }
  if (q.isError) {
    return (
      <div role="alert" className="col-span-full flex items-center gap-2 py-1 text-sm">
        <span className="text-danger">Could not load the pincodes.</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void q.refetch()}
        >
          Try again
        </Button>
      </div>
    );
  }
  if (q.data.length === 0) {
    return (
      <p className="col-span-full py-1 text-sm text-ink-3">
        No pincodes in this district
      </p>
    );
  }
  return (
    <ul
      role="group"
      className={cn(GRID, "col-span-full my-1 rounded-md bg-surface-3 p-2")}
    >
      {q.data.map((code) => {
        const itemKey = `p:${districtId}:${code}`;
        return (
          <TreeItem
            key={code}
            itemKey={itemKey}
            level={3}
            label={code}
            state={picked.has(code) ? "checked" : "unchecked"}
            tabStop={tabStop === itemKey}
            onActive={onActive}
            onToggleCheck={() => onToggleCode(code)}
          />
        );
      })}
    </ul>
  );
}

/**
 * One row. `open === undefined` means a leaf (nothing to expand); the focus is
 * on the `li` itself, as the tree pattern wants, and the box inside is for the
 * pointer — it is `tabIndex={-1}` so the keyboard has exactly one stop per row.
 */
function TreeItem({
  itemKey,
  level,
  label,
  detail,
  state,
  open,
  lockOpen,
  disabled,
  tabStop,
  onActive,
  onToggleOpen,
  onToggleCheck,
  children,
}: {
  itemKey: string;
  level: 1 | 2 | 3;
  label: string;
  /** Pincodes ticked under this node — drawn as a red (n). */
  detail?: number;
  state: NodeState;
  open?: boolean;
  lockOpen?: boolean;
  disabled?: boolean;
  tabStop: boolean;
  onActive: (key: string) => void;
  onToggleOpen?: () => void;
  onToggleCheck: () => void;
  children?: React.ReactNode;
}) {
  const expandable = open !== undefined;
  return (
    <li
      role="treeitem"
      aria-level={level}
      aria-checked={
        state === "mixed" ? "mixed" : state === "checked" ? "true" : "false"
      }
      aria-expanded={expandable ? open : undefined}
      aria-disabled={disabled ? true : undefined}
      tabIndex={tabStop ? 0 : -1}
      onFocus={(e) => {
        if (e.target === e.currentTarget) onActive(itemKey);
      }}
      // An open node hands its panel to the parent grid, so the panel can
      // span every column beneath the row.
      className={cn("outline-none", open && "contents")}
    >
      <div
        data-row
        className={cn(
          "flex min-w-0 items-center gap-1.5 rounded-md px-1 py-1 hover:bg-surface-3 [li:focus-visible>&]:ring-2 [li:focus-visible>&]:ring-ring/60",
          open && "font-semibold"
        )}
      >
        <Checkbox
          tabIndex={-1}
          aria-label={label}
          checked={state === "checked"}
          indeterminate={state === "mixed"}
          disabled={disabled}
          onCheckedChange={onToggleCheck}
        />
        <span className="min-w-0 truncate text-sm text-ink">{label}</span>
        {expandable ? (
          <button
            type="button"
            data-chevron
            tabIndex={-1}
            disabled={lockOpen}
            aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
            onClick={onToggleOpen}
            className="grid size-5 shrink-0 place-items-center rounded text-ink-3 hover:text-ink"
          >
            <ChevronRightIcon
              aria-hidden
              className={cn(
                "size-4 transition-transform",
                open ? "-rotate-90" : "rotate-90"
              )}
            />
          </button>
        ) : null}
        {detail ? (
          <span
            className="shrink-0 text-xs font-semibold text-danger tabular-nums"
            title={`${detail} pincodes selected`}
          >
            ({detail})
          </span>
        ) : null}
      </div>
      {children}
    </li>
  );
}
