import { useState } from "react";
import { ArrowLeft, SearchX } from "lucide-react";
import { useNavigate, useParams } from "react-router";
import { EligibleTechTable } from "@/components/escalations/EligibleTechTable";
import { LinkButton } from "@/components/shared/LinkButton";
import { PageMeta } from "@/components/shared/PageMeta";
import { EmptyState, ErrorState } from "@/components/shared/states";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { useAssignTechnician, useEscalation } from "@/hooks/useEscalations";
import { useEligibleTechnicians } from "@/hooks/useTechnicians";
import type { EligibleTechnician } from "@/types";

export default function ManualAssignPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();

  const {
    data: escalation,
    isLoading,
    isError,
    error,
    refetch,
  } = useEscalation(id);
  const techs = useEligibleTechnicians();
  const assign = useAssignTechnician();

  const [pending, setPending] = useState<string | null>(null);

  function onAssign(tech: EligibleTechnician) {
    setPending(tech.name);
    assign.mutate(
      { id, techName: tech.name },
      {
        onSuccess: (result) => {
          toast.add({ title: `${result.techName} assigned to ${result.id}` });
          navigate("/escalations");
        },
        onSettled: () => setPending(null),
      }
    );
  }

  return (
    <>
      <PageMeta
        title="Manual assignment"
        description="Assign an eligible technician to an escalated ticket."
      />

      <LinkButton
        variant="ghost"
        size="sm"
        className="mb-3.5 -ml-2"
        to="/escalations"
      >
        <ArrowLeft data-icon="inline-start" />
        Back
      </LinkButton>

      {isError ? (
        <ErrorState
          title="Couldn't load this escalation"
          error={error}
          onRetry={() => refetch()}
        />
      ) : !isLoading && !escalation ? (
        <EmptyState
          icon={SearchX}
          title="This ticket is no longer escalated"
          description="Someone has already picked it up, or it was assigned manually."
          action={
            <LinkButton to="/escalations">Back to escalations</LinkButton>
          }
        />
      ) : (
        <Card className="gap-0 py-0">
          <CardHeader className="border-b border-line-2 p-4.5">
            <CardTitle>
              <h2>Manual technician assignment</h2>
            </CardTitle>
            <p className="text-xs text-ink-3">
              Eligible by category, pincode and available bandwidth. Sorted by
              best fit.
            </p>
            <CardAction className="self-center">
              {isLoading || !escalation ? (
                <Skeleton className="h-4 w-56" />
              ) : (
                <span className="text-xs text-ink-2">
                  Ticket <b className="font-mono">{escalation.id}</b> ·{" "}
                  {escalation.product}
                </span>
              )}
            </CardAction>
          </CardHeader>

          <CardContent className="px-0">
            {assign.isError ? (
              <p
                role="alert"
                className="border-b border-line-2 bg-danger-bg px-4.5 py-3 text-xs text-danger"
              >
                {assign.error instanceof Error
                  ? assign.error.message
                  : "Something went wrong. Try again."}
              </p>
            ) : null}

            {/* DataTable brings its own toolbar and panel, so it is inset
                inside the card rather than sitting flush against it. */}
            <div className="p-4.5">
              <EligibleTechTable
                technicians={techs.data}
                isLoading={isLoading || techs.isLoading}
                error={techs.error}
                onRetry={() => techs.refetch()}
                onAssign={onAssign}
                assigningName={pending}
                isAssigning={assign.isPending}
              />
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
