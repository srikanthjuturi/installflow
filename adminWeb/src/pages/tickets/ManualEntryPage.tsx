import { useNavigate } from "react-router";
import { PageMeta } from "@/components/shared/PageMeta";
import { ErrorState } from "@/components/shared/states";
import { ManualEntryForm } from "@/components/tickets/ManualEntryForm";
import { toast } from "@/components/ui/toast";
import { useCreateTicket } from "@/hooks/useTickets";

export default function ManualEntryPage() {
  const navigate = useNavigate();
  const create = useCreateTicket();

  return (
    <>
      <PageMeta
        title="Manual ticket entry"
        description="Create a single ticket — installation, tech visit or service."
      />

      <header className="mb-4.5">
        <h2 className="text-base font-semibold">
          New ticket
        </h2>
        <p className="mt-1 text-[13px] text-ink-2">
          The same fields every intake channel needs. Enter a slot if you have
          already agreed one on the call, or leave it for the customer to pick.
        </p>
      </header>

      {create.isError ? (
        <div className="mb-3.5">
          <ErrorState
            title="Couldn't create the ticket"
            error={create.error}
            onRetry={() => create.reset()}
          />
        </div>
      ) : null}

      <ManualEntryForm
        isSubmitting={create.isPending}
        onCancel={() => navigate("/tickets")}
        onSubmit={(values) =>
          create.mutate(values, {
            onSuccess: (ticket) => {
              toast.add({
                title: `${ticket.code} created`,
                // Says what actually happened. The old copy promised a slot
                // request had been sent, which was true of neither branch:
                // with a slot there is nothing to request, and without one
                // the WhatsApp is still a later slice.
                description: ticket.slotStart
                  ? "Slot locked — eligible technicians can see it now."
                  : "Waiting for the customer to confirm a slot.",
              });
              navigate("/tickets");
            },
          })
        }
      />
    </>
  );
}
