import { useNavigate } from "react-router";
import { PageMeta } from "@/components/shared/PageMeta";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { PageSkeleton } from "@/components/shared/PageSkeleton";
import { ManualEntryForm } from "@/components/tickets/ManualEntryForm";
import { toast } from "@/components/ui/toast";
import { useMe } from "@/hooks/useAuth";
import { useCreateTicket } from "@/hooks/useTickets";

/**
 * Raise a ticket, with the vendor already known.
 *
 * The brand comes from `/auth/me`, not from `GET /vendors/options`: that
 * endpoint is gated on `masters.view` and for a staff caller lists every brand
 * in the company. A vendor should not ask a company-wide question to learn its
 * own name.
 */
export default function VendorNewTicketPage() {
  const navigate = useNavigate();
  const { data: me, isPending, isError, error, refetch } = useMe();
  const create = useCreateTicket();

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

  return (
    <>
      <PageMeta
        title="Raise a ticket"
        description="Raise an installation, demo or service ticket."
      />

      <h2 className="mb-4 text-lg font-semibold">Raise a ticket</h2>

      <ManualEntryForm
        vendor={{ id: me.vendor.id, name: me.vendor.name }}
        isSubmitting={create.isPending}
        onCancel={() => navigate("/portal/tickets")}
        onSubmit={(values) =>
          create.mutate(values, {
            onSuccess: (ticket) => {
              toast.add({ title: `${ticket.code} raised` });
              navigate("/portal/tickets");
            },
            // A failure is reported by the global mutation handler; the form
            // stays as it was so nothing typed is lost.
          })
        }
      />
    </>
  );
}
