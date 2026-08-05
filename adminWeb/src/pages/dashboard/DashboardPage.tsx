import { PageMeta } from "@/components/shared/PageMeta";
import { CardGridSkeleton } from "@/components/shared/states";

/** Placeholder — the real dashboard lands in the next commit. */
export default function DashboardPage() {
  return (
    <>
      <PageMeta title="Dashboard" description="Open tickets, SLA health and escalations." />
      <CardGridSkeleton />
    </>
  );
}
