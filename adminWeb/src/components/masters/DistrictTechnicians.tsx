import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useDistrictBreakdown } from "@/hooks/useTechnicians";
import { plural } from "@/lib/plural";
import type { DistrictTechnicianCount } from "@/types/technician";

/** Districts revealed per scroll. Uttar Pradesh has 75; most states are ~25. */
const PAGE = 15;

/**
 * Technicians per district for the state on screen.
 *
 * The point of the list is the ZEROES. An area manager looking at his own
 * state is looking for the districts nobody covers, so every district is
 * listed — staffed or not — and the empty ones are called out rather than
 * filtered away.
 *
 * Each staffed row links into the technician list already filtered to that
 * district, so the number and the names behind it are one click apart and
 * cannot disagree: both come from the same scoped query on the server.
 */
export function DistrictTechnicians({ stateId }: { stateId: string }) {
  const { data, isPending, isError } = useDistrictBreakdown(stateId);
  // A different state is a different list, and neither the search nor how far
  // it had been scrolled should survive the change. The caller keys this
  // component on the state id, which resets both — the React-sanctioned way to
  // do it, and cheaper than an effect that fires after a render nobody wanted.
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);

  const districts = useMemo(() => data?.districts ?? [], [data]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return districts;
    return districts.filter((d) => d.name.toLowerCase().includes(q));
  }, [districts, query]);

  const visible = matches.slice(0, shown);
  const hasMore = shown < matches.length;

  /**
   * Reveals the next page when the sentinel below the list scrolls into view.
   *
   * The list is not in a box of its own — it grows down the panel and the PAGE
   * scrolls, which is what makes a 75-district state readable. A fixed-height
   * inner scroller put a second scrollbar inside a page that already had one
   * and hid the count at the bottom.
   */
  const sentinel = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown((n) => n + PAGE);
        }
      },
      { rootMargin: "120px" }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [hasMore, matches.length]);

  if (isPending) {
    return (
      <Section>
        <div className="mt-2 space-y-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-7 rounded" />
          ))}
        </div>
      </Section>
    );
  }

  // Deliberately quiet rather than an ErrorState: this is a section inside a
  // panel whose main content loaded fine, and the failure is already in the
  // toaster. Replacing it with a red block would overstate it.
  if (isError || !data) {
    return (
      <Section>
        <p className="mt-2 text-[13px] text-ink-3">
          Couldn't load the district breakdown.
        </p>
      </Section>
    );
  }

  const { totalTechnicians, withoutDistrict } = data;
  const staffed = districts.filter((d) => d.technicianCount > 0);

  return (
    <Section>
      <p className="mt-0.5 text-[12px] text-ink-3">
        {totalTechnicians === 0
          ? "Nobody covers any part of this state yet."
          : `${plural(totalTechnicians, "technician")} across ${plural(staffed.length, "district")} of ${districts.length}.`}
      </p>

      {districts.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-3">
          The geography master holds no districts for this state.
        </p>
      ) : (
        <>
          {/* Worth its place from about twenty rows up, and Uttar Pradesh has
              75. Filters the list already in hand — the whole state came down
              in one response, so there is nothing to ask the server for. */}
          <div className="relative mt-2.5">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShown(PAGE);
              }}
              placeholder={`Search ${districts.length} districts`}
              aria-label="Search districts"
              className="h-9 pl-8 text-[13px]"
            />
          </div>

          {matches.length === 0 ? (
            <p className="mt-3 text-[13px] text-ink-3">
              No district here matches "{query.trim()}".
            </p>
          ) : (
            <ul className="mt-1.5 divide-y divide-line-2">
              {visible.map((d) => (
                <Row key={d.districtId} district={d} />
              ))}
              {hasMore && (
                <li
                  ref={sentinel}
                  className="py-2 text-center text-[11px] text-ink-3"
                >
                  Loading {matches.length - visible.length} more…
                </li>
              )}
            </ul>
          )}
        </>
      )}

      {withoutDistrict > 0 && (
        <p className="mt-2.5 rounded-md bg-warn-bg px-2.5 py-2 text-[12px] text-warn">
          {plural(withoutDistrict, "technician")} here cover only pincodes the
          geography master gives no district, so they are in none of the rows
          above.
        </p>
      )}

      {/* Said once, at the bottom, because the arithmetic invites the question
          the moment anybody adds the column up. */}
      {staffed.length > 0 && (
        <p className="mt-2 text-[11px] text-ink-3">
          A pincode can belong to more than one district, so a technician
          serving one is counted in each. The rows will not always add up to{" "}
          {totalTechnicians}.
        </p>
      )}
    </Section>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3.5 border-t border-line-2 pt-3.5">
      <h3 className="text-[13px] font-semibold text-ink">
        Technicians by district
      </h3>
      {children}
    </div>
  );
}

function Row({ district }: { district: DistrictTechnicianCount }) {
  const empty = district.technicianCount === 0;

  const body = (
    <>
      <span className="min-w-0 flex-1 truncate">{district.name}</span>
      <span className="shrink-0 text-[11px] text-ink-3">
        {plural(district.pincodeCount, "pincode")}
      </span>
      <span
        className={
          "w-10 shrink-0 text-right font-medium tabular-nums " +
          (empty ? "text-ink-3" : "text-ink")
        }
      >
        {empty ? "—" : district.technicianCount}
      </span>
    </>
  );

  // An empty district has nothing to link to: a filtered list of nobody is a
  // worse answer than the dash already given.
  return (
    <li className="text-[13px]">
      {empty ? (
        <div className="flex items-center gap-2.5 px-1 py-1.5 text-ink-2">
          {body}
        </div>
      ) : (
        <Link
          to={`/technicians?districtId=${district.districtId}`}
          className="flex items-center gap-2.5 rounded px-1 py-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink focus-visible:bg-surface-2"
        >
          {body}
        </Link>
      )}
    </li>
  );
}
