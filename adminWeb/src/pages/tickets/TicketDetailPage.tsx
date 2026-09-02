import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useLocation, useParams } from "react-router";
import { LinkButton } from "@/components/shared/LinkButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageMeta } from "@/components/shared/PageMeta";
import { SlaBadge, StatusBadge } from "@/components/shared/StatusBadge";
import { ErrorState } from "@/components/shared/states";
import { FactGrid } from "@/components/tickets/FactGrid";
import { CustomerVerdict } from "@/components/tickets/CustomerVerdict";
import { SerialMismatchBanner } from "@/components/tickets/SerialMismatch";
import {
  CustomerPanel,
  ForceClosureEvidence,
  ProofPanel,
  TechnicianPanel,
} from "@/components/tickets/SidePanels";
import { NoShowDialog } from "@/components/tickets/NoShowDialog";
import { Timeline } from "@/components/tickets/Timeline";
import { useFeatureAccess } from "@/hooks/useAuth";
import { readNavOrigin, useNavOrigin } from "@/hooks/useNavOrigin";
import { useRulesConfig } from "@/hooks/useSettings";
import { useRecordNoShow, useTicket } from "@/hooks/useTickets";
import { useRecordRecentlySeen } from "@/store/recentlySeen";
import { isTerminalTicketStatus } from "@/types";

/**
 * One ticket, on two surfaces.
 *
 * The ops console and the vendor portal show the same facts; only where "back"
 * goes and which actions exist differ. `actions` is a slot rather than a
 * boolean so the portal passes `null` and neither surface has to know what the
 * other renders.
 */
export default function TicketDetailPage({
  backTo,
  backLabel,
  actions,
}: {
  backTo?: string;
  backLabel?: string;
  /** The ops pair by default; `null` in the portal, where a vendor
   *  force-closing or re-assigning its own ticket makes no sense. */
  actions?: React.ReactNode;
} = {}) {
  const { id = "" } = useParams();
  const location = useLocation();

  /* One route, several ways in: the board, a technician's recent jobs, a
     technician's full list. Whoever navigated left an origin in router state,
     so "Back" returns THERE — and to the same page of the same filtered list,
     because the origin carries the query string too.

     Order matters. An explicit prop wins because that is the portal pinning a
     vendor to `/portal/tickets`, and a vendor must never be handed a link into
     the ops side. State comes next. The board is the last resort: state is gone
     after a reload or on a pasted link, and a dead-end detail page is worse
     than a back button that goes somewhere reasonable. */
  const origin = readNavOrigin(location.state);
  const backHref = backTo ?? origin?.backTo ?? "/tickets";
  const backText = backLabel ?? origin?.backLabel ?? "Back to tickets";

  /* What this page hands to Force close, Re-assign and Assign manually: come
     back HERE, and here is how to get back out again. Without the nested
     `backState`, a trip through an action screen quietly reset the trail, and
     the second Back landed on the ticket board — a page the reader never
     opened. */
  const actionOrigin = useNavOrigin("Back to ticket", origin);
  const {
    data: ticket,
    isLoading,
    isError,
    error,
    refetch,
    // `isFetching`, not `isLoading`: this is a re-read of a ticket already on
    // screen, and `isLoading` is only true when there is nothing to show.
    isFetching,
    dataUpdatedAt,
  } = useTicket(id);

  // The one switch between the two surfaces: a caller that named its actions
  // is the portal. Every ops-only control reads this, so a new one cannot be
  // added on the ops side and quietly appear on the vendor's.
  const isOps = actions === undefined;
  const { has } = useFeatureAccess();

  /* Confirming a no-show. Offered only when the ticket really is one: still
     `Assigned` — proof capture would have moved it to In Progress — with a
     window that has closed. Anything else and the server refuses, so a button
     there could only ever produce an error.

     The bands come from Rules configuration; an Area Manager can read them
     (see the API's `ReadRules`). Null while they load, which the dialog
     renders as no figure rather than a zero.

     Asked for on the ops side ONLY. A vendor holds neither `settings.view` nor
     `jobs.assign`, so on the portal the same call could only come back 403 —
     and the query cache toasts every failure, which is why opening a ticket in
     the portal greeted the vendor with "Not allowed". Nothing on that surface
     reads `rules`: the dialog it feeds is behind `isOps` too.

     "Closed" is measured against when the ticket was READ, not `Date.now()`:
     that would be an impure call during render, and the backstop refetch keeps
     it moving. The server re-checks anyway and refuses SLOT_STILL_OPEN. */
  const [noShowOpen, setNoShowOpen] = useState(false);
  const recordNoShow = useRecordNoShow();
  const { data: rules } = useRulesConfig({ enabled: isOps });
  const noShowAmount = rules?.penalty.at(-1)?.amount ?? null;
  const canRecordNoShow =
    isOps &&
    ticket?.status === "Assigned" &&
    ticket.slotEnd !== null &&
    new Date(ticket.slotEnd).getTime() < dataUpdatedAt;

  // Into the topbar search's "Recently seen". Recorded here rather than only on
  // a search result, so a ticket opened from the board or from the bell counts
  // as seen too. No-ops in the portal, which has no global search and whose
  // session has no ops trail to add to.
  useRecordRecentlySeen(
    "ticket",
    ticket?.id,
    ticket?.code,
    ticket ? `${ticket.customerName} · ${ticket.pincode}` : null
  );

  // Closed, Force-Closed and Cancelled are the end of the record. Force-closing
  // a ticket that is already closed, or sending a technician to a job nobody is
  // waiting on, are not things a manager can mean — so the controls go rather
  // than sit there waiting to be pressed and rejected.
  const isSettled = !!ticket && isTerminalTicketStatus(ticket.status);
  const canAct = isOps && !isSettled;

  /* Ending a job without the customer is its own permission, not part of
     "can act": `jobs.force_close` is granted to the four staff roles and to
     no technician, where `jobs.close` — the key that already existed — means
     "close your own job" and belongs to admins and technicians. Hiding the
     button is presentation; the server refuses the call regardless. */
  const canForceClose = canAct && has("jobs.force_close");

  return (
    <>
      <PageMeta
        title={`Ticket ${id}`}
        description="Ticket timeline and audit trail."
      />

      <LinkButton
        variant="ghost"
        size="sm"
        className="mb-3.5 -ml-2"
        to={backHref}
        state={origin?.backState}
      >
        <ArrowLeft data-icon="inline-start" />
        {backText}
      </LinkButton>

      {isError ? (
        <ErrorState
          title="Couldn't load this ticket"
          error={error}
          onRetry={() => refetch()}
        />
      ) : isLoading || !ticket ? (
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.55fr_1fr]">
          <div className="flex flex-col gap-3.5">
            <Skeleton className="h-52 rounded-lg" />
            <Skeleton className="h-96 rounded-lg" />
          </div>
          <div className="flex flex-col gap-3.5">
            <Skeleton className="h-40 rounded-lg" />
            <Skeleton className="h-32 rounded-lg" />
            <Skeleton className="h-64 rounded-lg" />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.55fr_1fr]">
          <div className="flex flex-col gap-3.5">
            <Card>
              <CardContent>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h2 className="font-mono text-base font-semibold">
                        {ticket.code}
                      </h2>
                      <StatusBadge status={ticket.status} />
                      <SlaBadge state={ticket.slaState} />
                    </div>
                    <p className="mt-1.5 text-[13px] text-ink-2">
                      {ticket.modelName} · {ticket.serviceType} · {ticket.serviceLevelHours}h
                    </p>
                  </div>

                  {isOps ? (
                    canAct ? (
                      <div className="flex flex-wrap gap-2.5">
                        {/* Beside Force close rather than in the technician
                            panel: it is a decision about the ticket that also
                            charges somebody, and it belongs with the other
                            control that ends a job badly. */}
                        {canRecordNoShow ? (
                          <Button
                            variant="outline"
                            className="hover:border-danger hover:text-danger"
                            onClick={() => setNoShowOpen(true)}
                          >
                            Record no-show
                          </Button>
                        ) : null}
                        {canForceClose ? (
                          <LinkButton
                            variant="outline"
                            className="hover:border-danger hover:text-danger"
                            to={`/tickets/${ticket.id}/force-close`}
                            state={actionOrigin}
                          >
                            Force close
                          </LinkButton>
                        ) : null}
                        <LinkButton
                          to={`/tickets/${ticket.id}/assign`}
                          state={actionOrigin}
                        >
                          Re-assign
                        </LinkButton>
                      </div>
                    ) : null
                  ) : (
                    actions
                  )}
                </div>

                <FactGrid ticket={ticket} />

                {/* Above the timeline and below the facts: it is about one of
                    those facts, and it is the reason anybody arriving from the
                    bell opened this ticket. Both surfaces show it — the vendor
                    holds the invoice, so it is often theirs to settle. */}
                <SerialMismatchBanner ticket={ticket} />
              </CardContent>
            </Card>

            {/* The same query the whole page reads — refreshing the trail
                refreshes the facts above it, which is the honest behaviour:
                a timeline newer than the status beside it would be worse
                than a stale one. */}
            <Timeline
              events={ticket.timeline}
              onRefresh={() => void refetch()}
              isRefreshing={isFetching}
            />
          </div>

          <div className="flex flex-col gap-3.5">
            {/* Above the customer's contact details: on an escalated ticket
                this is the reason the manager opened the page, and it should
                not be below the fold under an address they already know. */}
            <CustomerVerdict ticket={ticket} />
            <CustomerPanel ticket={ticket} />
            <TechnicianPanel
              ticket={ticket}
              // Assignment is an ops job. On the portal this was a button
              // that linked into the ops assignment screen, which
              // `RequirePortalFeature` denies — a control that could only ever
              // bounce the vendor who pressed it.
              //
              // `/tickets/:id/assign` is now the only assignment screen; the
              // escalation queue's old copy at `/escalations/:id/assign`
              // redirects here.
              //
              // It disappears on a settled ticket for the same reason the pair
              // in the header do: it is the same re-assignment, reached from
              // the panel it would change.
              action={
                canAct ? (
                  <LinkButton
                    variant="outline"
                    size="sm"
                    to={`/tickets/${ticket.id}/assign`}
                    state={actionOrigin}
                  >
                    Assign manually
                  </LinkButton>
                ) : null
              }
            />
            <ProofPanel ticket={ticket} />
            {/* Only where there is a closure to justify. Ops-only: the whole
                point of the record is that a colleague can audit the decision,
                and the vendor is the outside party it was taken about. */}
            {isOps && ticket.status === "Force-Closed" ? (
              <ForceClosureEvidence ticket={ticket} />
            ) : null}
          </div>
        </div>
      )}

      {/* Outside the loading branch so it survives the refetch its own success
          triggers — the ticket reloads as `Escalated`, and a dialog unmounted
          mid-flight would take its closing animation and its pending state
          with it. */}
      {ticket ? (
        <NoShowDialog
          open={noShowOpen}
          onOpenChange={setNoShowOpen}
          technicianName={ticket.technicianName ?? "the technician"}
          amount={noShowAmount}
          isPending={recordNoShow.isPending}
          onConfirm={(note) =>
            recordNoShow.mutate(
              { id: ticket.id, note },
              // Closed only on success. A refusal — somebody moved the ticket
              // while the manager was deciding — is reported by the toaster,
              // and closing the dialog under it would hide what was refused.
              { onSuccess: () => setNoShowOpen(false) }
            )
          }
        />
      ) : null}
    </>
  );
}
