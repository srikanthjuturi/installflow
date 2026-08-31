import { AlertTriangle, ArrowLeft, CheckCircle2, Lock } from "lucide-react";
import { DistrictTechnicians } from "@/components/masters/DistrictTechnicians";
import { LinkButton } from "@/components/shared/LinkButton";
import { Button } from "@/components/ui/button";
import { plural } from "@/lib/plural";
import type { GeoState } from "@/types/geo";
import type { TerritoryState } from "@/types/territory";

interface Props {
  state: GeoState;
  /** Undefined when the state is outside the caller's territory. */
  coverage?: TerritoryState;
  onClear: () => void;
}

/**
 * One state, picked off the map: who covers it and what to do if nobody does.
 *
 * It stops at naming the gap and pointing at Users & roles. Assignment lives in
 * exactly one place, and a second surface that writes territory is the thing
 * this page was built read-only to avoid.
 */
export function TerritoryStatePanel({ state, coverage, onClear }: Props) {
  const outside = !coverage;
  const covered = coverage?.isCovered ?? false;
  const who = coverage?.coveredBy;

  return (
    <section className="rounded-lg border border-line bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-2.5">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">{state.name}</h2>
          <p className="text-[12px] text-ink-3">
            {state.regionName} region · {plural(state.districtCount, "district")} ·{" "}
            {plural(state.pincodeCount, "pincode")}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onClear}>
          <ArrowLeft data-icon="inline-start" />
          All regions
        </Button>
      </header>

      <div className="p-4">
        {outside ? (
          <Note
            icon={Lock}
            tone="text-ink-2"
            title="Outside your territory"
            body="It is drawn so the map still reads as India, but it is not yours to see or assign. A national head or the region's own head can act on it."
          />
        ) : covered ? (
          <Note
            icon={CheckCircle2}
            tone="text-ok"
            title={who ? `Covered by ${who.name}` : "Covered"}
            body={
              who
                ? `${who.email ?? "no email on file"}${who.isActive ? "" : " · this membership is inactive"}. Every pincode in ${state.name} routes to them.`
                : // Covered-with-no-name is honest, not a gap: `isCovered` is
                  // company-wide, while the manager is only shown to somebody
                  // whose territory includes them.
                  `An area manager outside your territory holds this state, so their name is not shown here. It is not free to assign.`
            }
          />
        ) : (
          <>
            <Note
              icon={AlertTriangle}
              tone="text-warn"
              title="No area manager"
              body={`Nothing in ${state.name} can be allocated: with no manager covering it, no technician is eligible and a ticket here notifies nobody. ${plural(state.pincodeCount, "pincode")} are affected.`}
            />
            <div className="mt-3.5">
              <LinkButton
                to="/settings/users"
                variant="outline"
                className="border-brand-400 bg-surface text-brand-500 hover:bg-brand-100"
              >
                Assign an Area Manager
              </LinkButton>
            </div>
          </>
        )}

        {coverage?.isMine && !outside && (
          <p className="mt-3.5 border-t border-line-2 pt-3 text-[12px] text-ink-3">
            This state is in your own territory.
          </p>
        )}

        {/* Only for a state the caller can actually see. Outside their
            territory the counts would be somebody else's staffing, which is
            exactly what the rest of this panel declines to show. */}
        {!outside && (
          // Keyed on the state so picking another one resets the search box
          // and the scroll position rather than carrying them across.
          <DistrictTechnicians key={state.id} stateId={state.id} />
        )}
      </div>
    </section>
  );
}

function Note({
  icon: Icon,
  tone,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className={`mt-0.5 size-[18px] shrink-0 ${tone}`} aria-hidden />
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-[13px] text-ink-2">{body}</p>
      </div>
    </div>
  );
}
