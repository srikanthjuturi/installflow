import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Technician } from "@/types/technician";
import { MODE_LABEL } from "./onboarding";

function date(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Name over role, so the person reads first and the authority sits under it. */
function Person({ name, role }: { name: string; role: string | null }) {
  return (
    <span className="flex flex-col items-end">
      <span>{name}</span>
      {role ? (
        <span className="text-[11px] font-normal text-ink-3">{role}</span>
      ) : null}
    </span>
  );
}

/**
 * The audit trail: who appointed this technician, who filled the record in, and
 * when each happened.
 *
 * Every "who" is a NAME AND A ROLE, never a relationship word. "Their manager"
 * was true and useless — it hid the two facts somebody reading this page is
 * actually after: which person, and with what authority. An Area Manager
 * onboarding into their own pincodes and a National Head reaching across the
 * country are very different acts, and the row has to say which one happened.
 *
 * Mode and "filled in by" stay separate rows because they answer different
 * questions — a manager can invite someone who then registers themselves, so
 * how it started and who typed it are not the same.
 */
export function TechOnboardingCard({ tech }: { tech: Technician }) {
  const { onboarding } = tech;
  const appointer = onboarding.appointedByName ?? "—";

  const rows: Array<[string, React.ReactNode]> = [
    ["Onboarded", MODE_LABEL[onboarding.mode]],
    [
      "Appointed by",
      <Person name={appointer} role={onboarding.appointedByRoleLabel} />,
    ],
    [
      "Details filled in by",
      onboarding.registeredBy === "self" ? (
        /* The technician typed their own name, photo and coverage from the
           invite link — worth saying plainly, because it is the one case where
           the record was not written by staff. */
        <Person name={tech.name} role="The technician" />
      ) : (
        <Person name={appointer} role={onboarding.appointedByRoleLabel} />
      ),
    ],
    ["Region", tech.regionName],
    ["Invited on", date(onboarding.appointedAt)],
    ["Registered on", date(onboarding.registeredAt)],
  ];

  return (
    <Card>
      <CardContent>
        <h3 className="mb-3 text-[11px] font-bold tracking-[0.04em] text-ink-3 uppercase">
          Onboarding
        </h3>
        <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="flex items-start justify-between gap-3 border-b border-line-2 pb-2.5 last:border-0 sm:last:border-b sm:[&:nth-last-child(-n+2)]:border-0"
            >
              <dt className="pt-px text-xs text-ink-3">{label}</dt>
              <dd className="text-right text-xs font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

export function TechOnboardingCardSkeleton() {
  return (
    <Card>
      <CardContent>
        <Skeleton className="mb-3 h-3 w-24" />
        <div className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
