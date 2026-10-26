import { useSearchParams } from "react-router";
import { cn } from "@/lib/utils";
import type { AllowanceScope } from "@/types/allowances";
import { SpeedRulesSection } from "./SpeedRulesSection";
import { TravelRulesForm } from "./TravelRulesForm";

type AllowanceView = "travel" | "speed";

const VIEWS: { value: AllowanceView; label: string }[] = [
  { value: "travel", label: "Travel" },
  { value: "speed", label: "Speed" },
];

/**
 * Travel and speed allowance rules for ONE franchisee, on any surface that may
 * show them — the franchise portal (edit), Configuration → Allowances (edit for
 * Admin / National Head, read-only below), and a non-home franchisee's page
 * (read-only). The surface passes WHICH franchisee as an `AllowanceScope` and
 * whether it may edit; nothing here knows which shell it is in, and neither
 * page imports the other.
 *
 * `?view=travel|speed` is the `CreditsPage` ViewSwitch pattern: one view at a
 * time, held in the URL so a view is a link. The children are keyed, so
 * switching starts the other from its own defaults rather than carrying one's
 * filters into the other.
 */
export function AllowancesView({
  scope,
  readOnly,
  franchiseeName,
}: {
  scope: AllowanceScope;
  readOnly: boolean;
  /** Names whose rules these are, on the surfaces that do not already say. */
  franchiseeName?: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const view: AllowanceView =
    searchParams.get("view") === "speed" ? "speed" : "travel";

  const onView = (next: AllowanceView) => {
    const url = new URLSearchParams(searchParams);
    // The speed table's own filter must not follow the reader to Travel.
    url.delete("type");
    if (next === "travel") url.delete("view");
    else url.set("view", next);
    setSearchParams(url, { replace: true });
  };

  return (
    <section
      aria-label={
        franchiseeName
          ? `Allowance rules for ${franchiseeName}`
          : "Allowance rules"
      }
    >
      {scope.kind === "home" && franchiseeName ? (
        <p className="mb-3.5 text-[13px] text-ink-2">
          Travel and speed allowances for {franchiseeName}&apos;s technicians
        </p>
      ) : null}

      <div role="group" aria-label="What to show" className="mb-3.5 flex flex-wrap gap-2">
        {VIEWS.map((o) => {
          const active = view === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              onClick={() => onView(o.value)}
              className={cn(
                "inline-flex h-10 items-center gap-2 rounded-lg border px-3.25 text-xs font-semibold whitespace-nowrap transition-colors",
                active
                  ? "border-brand-500 bg-brand-500 text-white"
                  : "border-input bg-surface text-ink-2 hover:border-brand-400 hover:text-ink"
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>

      {view === "speed" ? (
        <SpeedRulesSection key="speed" scope={scope} readOnly={readOnly} />
      ) : (
        <TravelRulesForm key="travel" scope={scope} readOnly={readOnly} />
      )}
    </section>
  );
}
