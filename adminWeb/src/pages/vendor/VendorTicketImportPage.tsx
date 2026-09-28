import { AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router";
import { PageMeta } from "@/components/shared/PageMeta";
import { PageSkeleton } from "@/components/shared/PageSkeleton";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { TicketImportPanel } from "@/components/tickets/TicketImportPanel";
import { useMe } from "@/hooks/useAuth";
import { useBrand } from "@/hooks/useBrand";
import { useIntakeStatus } from "@/hooks/useTickets";

/**
 * Raise many tickets from one spreadsheet — the Excel intake channel.
 *
 * A PAGE, where the two sibling importers are dialogs, and the difference is
 * not taste. This is the vendor's INTAKE screen, the peer of
 * `/portal/tickets/new` which is also a page; it is a nav destination rather
 * than an action on something already on screen; and a 200-row rejects table
 * needs room a dialog does not have.
 *
 * It appears in the rail only for a vendor whose `intake_channels` includes
 * `Excel` — `portalNav.ts` does that from one entry, and `RequirePortalFeature`
 * redirects anybody who types the URL without it.
 *
 * Like the New ticket page, it says intake is paused ABOVE the form rather than
 * after a file has been chosen and checked. The vendor sees that it is paused
 * and nothing about the balance behind it.
 */
export default function VendorTicketImportPage() {
  const navigate = useNavigate();
  const { data: me, isPending, isError, error, refetch } = useMe();
  const intake = useIntakeStatus();
  const brand = useBrand();

  if (isPending) return <PageSkeleton />;
  if (isError) {
    return (
      <ErrorState
        title="Couldn't load your account"
        error={error}
        onRetry={() => refetch()}
      />
    );
  }
  if (!me?.vendor) {
    return (
      <EmptyState
        title="Your account is not linked to a vendor"
        description="Ask the team who set it up to check your account."
      />
    );
  }

  const paused = intake.data?.paused === true;

  return (
    <>
      <PageMeta
        title="Import tickets"
        description="Raise many tickets from one spreadsheet."
      />

      <h2 className="mb-4 text-lg font-semibold">Import tickets</h2>

      {paused ? (
        <section
          role="status"
          className="mb-3.5 flex items-start gap-2.5 rounded-md border border-warn/30 bg-warn-bg p-3.5 text-warn"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="text-sm font-semibold">New tickets are paused</p>
            <p className="mt-0.5 text-[13px] leading-relaxed">
              {brand.name} needs to recharge before new tickets can be raised.
            </p>
          </div>
        </section>
      ) : null}

      <div className="rounded-lg border border-line bg-surface-1 p-4 sm:p-5">
        <TicketImportPanel
          onDone={() => navigate("/portal/tickets")}
        />
      </div>
    </>
  );
}
