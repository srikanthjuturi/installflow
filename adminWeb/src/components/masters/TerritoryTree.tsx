import { Map } from "lucide-react";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { TerritoryPerson, TerritoryRegion } from "@/types/territory";

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

/** "1 state" / "3 states" — the count is the point, so it reads correctly. */
function count(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function RegionCard({ region }: { region: TerritoryRegion }) {
  const { regionalHeads, areaManagers } = region;
  const empty = regionalHeads.length === 0 && areaManagers.length === 0;

  return (
    <Card className="[--card-spacing:0rem]">
      <div className="flex flex-wrap items-center gap-3 border-b border-line-2 bg-surface-2 px-4.5 py-3.5">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-md bg-brand-500 text-white"
          aria-hidden
        >
          <Map className="size-4.5" />
        </span>
        <h2 className="text-[15px] font-semibold">{region.name} Region</h2>
        <span className="ml-auto text-xs text-ink-3">
          {count(regionalHeads.length, "Regional Head")} ·{" "}
          {count(areaManagers.length, "Area Manager")} ·{" "}
          {count(region.stateCount, "state")}
        </span>
      </div>

      {empty ? (
        /* An unmapped region is information, not a row to hide: nobody is
           notified for tickets in it. */
        <p className="px-4.5 py-4 text-xs text-ink-3">
          Nobody covers this region yet — assign a Regional Head or an Area
          Manager from Users &amp; roles.
        </p>
      ) : (
        /* Both levels are rows: the region's people are the mapping, and a
           Regional Head shown only as a caption reads as decoration. */
        <ul
          className="flex flex-col p-2.5"
          aria-label={`People in ${region.name} Region`}
        >
          {regionalHeads.map((head) => (
            <li key={head.membershipId}>
              <PersonRow person={head} role="Regional Head" />
            </li>
          ))}
          {areaManagers.map((asm) => (
            <li key={asm.membershipId}>
              <PersonRow person={asm} role="Area Manager" states={asm.states} />
            </li>
          ))}
          {regionalHeads.length === 0 ? (
            <li className="px-3 py-2 text-[11px] text-ink-3">
              No Regional Head assigned to this region.
            </li>
          ) : null}
          {areaManagers.length === 0 ? (
            <li className="px-3 py-2 text-[11px] text-ink-3">
              No Area Manager covers this region yet.
            </li>
          ) : null}
        </ul>
      )}

      {/* The gap, named. A count of covered states tells nobody what to do
          next; the states nobody covers is the work. */}
      {region.unassignedStates.length ? (
        <div className="border-t border-line-2 px-4.5 py-3">
          <p className="text-[11px] font-medium text-warn">
            {count(region.unassignedStates.length, "state has", "states have")} no
            Area Manager
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {region.unassignedStates.map((state) => (
              <li
                key={state}
                className="rounded-sm bg-warn-bg px-2 py-0.75 text-[11px] font-medium text-warn"
              >
                {state}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

/**
 * One person in the region. An area manager owns states, and every pincode
 * inside them is what technician notification matches on (category + pincode +
 * free bandwidth), so the chips are the mapping itself, not decoration. A
 * regional head owns the whole region, so he has none — the row says who, the
 * chips say where.
 */
function PersonRow({
  person,
  role,
  states,
}: {
  person: TerritoryPerson;
  role: string;
  states?: string[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md px-3 py-2.75 transition-colors hover:bg-surface-2">
      {/* The photo when there is one. The tint is the INITIALS state's — a
          photo overrides both, so the head of a region no longer reads as the
          senior row by colour alone. The role is on the line beside it, which
          is where it was already being read from. */}
      <UserAvatar
        name={person.name}
        src={person.profileImageUrl}
        className={cn(
          "size-7.5 text-[11px]",
          states
            ? "bg-status-assigned-bg text-brand-400"
            : "bg-brand-500 text-white"
        )}
      />
      <div className="min-w-37.5">
        <h3 className="text-[13px] font-semibold">{person.name}</h3>
        <p className="text-[11px] text-ink-3">
          {role}
          {person.isActive ? "" : " · Suspended"}
        </p>
      </div>
      {states ? (
        <ul
          className="flex flex-1 flex-wrap gap-1.5"
          aria-label={`States covered by ${person.name}`}
        >
          {states.map((state) => (
            <li
              key={state}
              className="rounded-sm bg-surface-3 px-2 py-0.75 text-[11px] font-medium text-ink-2"
            >
              {state}
            </li>
          ))}
        </ul>
      ) : (
        <span className="flex-1 text-[11px] text-ink-3">
          Covers the whole region
        </span>
      )}
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
