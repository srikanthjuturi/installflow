import { ArrowLeft } from "lucide-react";
import { useParams } from "react-router";
import { LinkButton } from "@/components/shared/LinkButton";
import { PageMeta } from "@/components/shared/PageMeta";
import { ErrorState } from "@/components/shared/states";
import { JobHistoryTable } from "@/components/technicians/JobHistoryTable";
import {
  TechProfileHeader,
  TechStats,
} from "@/components/technicians/TechProfileHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { useTechnician } from "@/hooks/useTechnicians";

export default function TechnicianProfilePage() {
  const { id = "" } = useParams();
  const { data: tech, isLoading, isError, error, refetch } = useTechnician(id);

  return (
    <>
      <PageMeta
        title={`Technician ${id}`}
        description="Category, pincode, bandwidth, cancellations and job history."
      />

      <LinkButton
        variant="ghost"
        size="sm"
        className="mb-3.5 -ml-2"
        to="/technicians"
      >
        <ArrowLeft data-icon="inline-start" />
        Back to technicians
      </LinkButton>

      {isError ? (
        <ErrorState
          title="Couldn't load this technician"
          error={error}
          onRetry={() => refetch()}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1fr_1.7fr]">
          {isLoading || !tech ? (
            <Skeleton className="h-125 rounded-xl" />
          ) : (
            <TechProfileHeader tech={tech} />
          )}

          <div className="flex flex-col gap-3.5">
            {isLoading || !tech ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-21 rounded-xl" />
                ))}
              </div>
            ) : (
              <TechStats tech={tech} />
            )}

            {/* The skeleton is the real table, row for row — never a spinner. */}
            <JobHistoryTable
              history={tech?.history}
              isLoading={isLoading || !tech}
            />
          </div>
        </div>
      )}
    </>
  );
}
