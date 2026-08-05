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
        description="Create a single installation or demo ticket."
      />

      <header className="mb-4.5">
        <h2 className="text-base font-semibold">
          New installation / demo ticket
        </h2>
        <p className="mt-1 text-[13px] text-ink-2">
          All fields are required regardless of intake channel. The customer
          picks a slot after validation.
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
                title: `${ticket.id} created`,
                description: "Slot request sent to the customer.",
              });
              navigate("/tickets");
            },
          })
        }
      />
    </>
  );
}
