import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Technician } from "@/types/technician";
import { MODE_LABEL, REGISTERED_BY_LABEL } from "./onboarding";

function date(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * The audit trail: who appointed this technician, who filled the record in, and
 * when each happened.
 *
 * It lives on the profile rather than the table because the table has room for
 * one of these facts and this screen is where somebody asks the question. The
 * mode and the "filled in by" line are deliberately separate rows — a manager
 * can invite someone who then registers themselves, so "how it started" and
 * "who typed it" are two different answers.
 */
export function TechOnboardingCard({ tech }: { tech: Technician }) {
  const { onboarding } = tech;

  const rows: Array<[string, React.ReactNode]> = [
    ["Onboarded", MODE_LABEL[onboarding.mode]],
    ["Details filled in by", REGISTERED_BY_LABEL[onboarding.registeredBy]],
    ["Appointed by", onboarding.appointedByName ?? "—"],
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
            <div key={label} className="flex items-center justify-between gap-3">
              <dt className="text-xs text-ink-3">{label}</dt>
              <dd className="text-xs font-medium">{value}</dd>
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
