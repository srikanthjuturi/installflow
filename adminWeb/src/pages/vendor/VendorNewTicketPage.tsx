import { AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router";
import { PageMeta } from "@/components/shared/PageMeta";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { PageSkeleton } from "@/components/shared/PageSkeleton";
import { ManualEntryForm } from "@/components/tickets/ManualEntryForm";
import { toast } from "@/components/ui/toast";
import { useMe } from "@/hooks/useAuth";
import { useBrand } from "@/hooks/useBrand";
import { useCreateTicket, useIntakeStatus } from "@/hooks/useTickets";
import { useRecordAddressSearch } from "@/hooks/useVendors";
import {
  trackTicketRaiseFailed,
  trackTicketRaised,
} from "@/lib/analytics/events";
import { ApiError } from "@/services/client";
import { useSession } from "@/store/session";

/**
 * Raise a ticket, with the vendor already known.
 *
 * The vendor comes from `/auth/me`, not from `GET /vendors/options`: that
 * endpoint is gated on `masters.view` and for a staff caller lists every vendor
 * in the company. A vendor should not ask a company-wide question to learn its
 * own name.
 *
 * When the company has no credits left for another ticket, the page says so
 * ABOVE the form and the form will not submit — nobody should fill in a whole
 * ticket to be told no. The vendor sees that intake is paused and nothing about
 * the balance behind it.
 */
export default function VendorNewTicketPage() {
  const navigate = useNavigate();
  const activeCompanyId = useSession((s) => s.activeCompanyId);
  const { data: me, isPending, isError, error, refetch } = useMe();
  const intake = useIntakeStatus();
  const brand = useBrand();
  const create = useCreateTicket();
  const recordSearch = useRecordAddressSearch();

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
    // An account with no vendor cannot raise anything. Both creation paths set
    // the link, so this is a data fault rather than a permission question —
    // say so instead of rendering a form that would 403 on submit.
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
        title="Raise a ticket"
        description="Raise an installation, demo or service ticket."
      />

      <h2 className="mb-4 text-lg font-semibold">Raise a ticket</h2>

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

      <ManualEntryForm
        vendor={{ id: me.vendor.id, name: me.vendor.name }}
        /* The capability is decided here, not inside the shared address
           control: this is the one component that knows the caller is a vendor
           and which vendor it is. `me` is cached for five minutes, so flipping
           the switch in the console reaches an open tab on its next refetch
           rather than instantly — fine, because this is a preference and not a
           permission. */
        addressSearch={{
          enabled: me.vendor.addressSearchEnabled,
          onSearch: (sessionId) => recordSearch.mutate(sessionId),
        }}
        paused={paused}
        isSubmitting={create.isPending}
        onCancel={() => navigate("/portal/tickets")}
        onSubmit={(values) =>
          create.mutate(values, {
            onSuccess: (ticket) => {
              toast.add({ title: `${ticket.code} raised` });
              if (activeCompanyId) {
                trackTicketRaised(ticket.id, activeCompanyId);
              }
              navigate("/portal/tickets");
            },
            // The failure itself is reported by the global mutation handler
            // (toast + `trackApiError`, both in `App.tsx`); this adds the
            // conversion-funnel signal that a raise specifically failed, and
            // why — the form stays as it was so nothing typed is lost.
            onError: (err) => {
              trackTicketRaiseFailed(
                err instanceof ApiError ? (err.code ?? err.message) : "unknown"
              );
            },
          })
        }
      />
    </>
  );
}
