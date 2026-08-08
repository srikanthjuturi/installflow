import { Map } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { TerritoryAreaManager, TerritoryRegion } from "@/types/territory";

/** "Ravi Sharma" → "RS". Derived, so no initials field has to be stored. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "");
  return letters.toUpperCase() || "?";
}

/**
 * The hierarchy is carried by real nesting — `ul > li > ul > li > ul > li` —
 * not by indentation. A screen reader announces "list, 2 items" at each level
 * and can walk regions without reading every pincode; sighted users get the
 * same structure from the card bands. Indentation alone would leave the
 * relationship invisible to anyone not looking at it.
 */
export function TerritoryTree({ regions }: { regions: TerritoryRegion[] }) {
  return (
    <ul className="flex flex-col gap-3" aria-label="Regions">
      {regions.map((region) => (
        <li key={region.id}>
          <RegionCard region={region} />
        </li>
      ))}
    </ul>
  );
}

function RegionCard({ region }: { region: TerritoryRegion }) {
  const heads = region.regionalHeads.map((h) => h.name).join(", ");

  return (
    <Card className="[--card-spacing:0rem]">
      <div className="flex flex-wrap items-center gap-3 border-b border-line-2 bg-surface-2 px-4.5 py-3.5">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-md bg-brand-500 text-white"
          aria-hidden
        >
          <Map className="size-4.5" />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold">{region.name} Region</h2>
          <p className="text-xs text-ink-3">
            {heads ? `RSH · ${heads}` : "No Regional Head assigned"}
          </p>
        </div>
        <span className="ml-auto text-xs text-ink-3">
          {region.areaManagers.length} ASMs · {region.pincodeCount} pincodes
        </span>
      </div>

      {region.areaManagers.length ? (
        <ul
          className="flex flex-col p-2.5"
          aria-label={`Area Managers in ${region.name} Region`}
        >
          {region.areaManagers.map((asm) => (
            <li key={asm.membershipId}>
              <AsmRow asm={asm} />
            </li>
          ))}
        </ul>
      ) : (
        /* An unmapped region is information, not a row to hide: nobody is
           notified for tickets in it. */
        <p className="px-4.5 py-4 text-xs text-ink-3">
          No Area Manager covers this region yet — assign one from Users &amp;
          roles.
        </p>
      )}
    </Card>
  );
}

/**
 * An area manager owns a pincode range, and that range is one of the three
 * things technician notification matches on (category + pincode + free
 * bandwidth). The chips are the mapping itself, not decoration.
 */
function AsmRow({ asm }: { asm: TerritoryAreaManager }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md px-3 py-2.75 transition-colors hover:bg-surface-2">
      <span
        className="grid size-7.5 shrink-0 place-items-center rounded-full bg-status-assigned-bg text-[11px] font-semibold text-brand-400"
        aria-hidden
      >
        {initialsOf(asm.name)}
      </span>
      <div className="min-w-37.5">
        <h3 className="text-[13px] font-semibold">{asm.name}</h3>
        <p className="text-[11px] text-ink-3">
          ASM{asm.isActive ? "" : " · Suspended"}
        </p>
      </div>
      <ul
        className="flex flex-1 flex-wrap gap-1.5"
        aria-label={`Pincodes serviced by ${asm.name}`}
      >
        {asm.pincodes.map((pincode) => (
          <li
            key={pincode}
            className="rounded-sm bg-surface-3 px-2 py-0.75 font-mono text-[11px] font-medium text-ink-2"
          >
            {pincode}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Two region cards in the real shape — header band, then ASM rows with chips. */
export function TerritoryTreeSkeleton({
  regions = 2,
  asms = 2,
}: {
  regions?: number;
  asms?: number;
}) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: regions }).map((_, r) => (
        <Card key={r} className="[--card-spacing:0rem]">
          <div className="flex items-center gap-3 border-b border-line-2 bg-surface-2 px-4.5 py-3.5">
            <Skeleton className="size-9 shrink-0" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="ml-auto h-3 w-28" />
          </div>
          <div className="flex flex-col p-2.5">
            {Array.from({ length: asms }).map((__, a) => (
              <div
                key={a}
                className="flex flex-wrap items-center gap-3 px-3 py-2.75"
              >
                <Skeleton className="size-7.5 shrink-0 rounded-full" />
                <div className="flex min-w-37.5 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-2.5 w-16" />
                </div>
                <div className="flex flex-1 flex-wrap gap-1.5">
                  {Array.from({ length: 5 }).map((___, p) => (
                    <Skeleton key={p} className="h-5 w-13 rounded-sm" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
