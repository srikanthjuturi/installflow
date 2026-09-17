import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/components/ui/toast";
import { useDeleteTechnician } from "@/hooks/useTechnicians";
import type { Technician } from "@/types/technician";

/**
 * Remove a technician (soft-delete of the membership — see
 * `service.delete_technician`). They're signed out immediately and stop
 * receiving new jobs; their job history and past proof stay on record.
 *
 * The server refuses with 409 `TECHNICIAN_HAS_OPEN_JOBS` while a job is still
 * open, and that message surfaces through the global toaster like any other
 * mutation failure (hard rule 9) — no inline handling needed here.
 */
export function DeleteTechnicianDialog({
  open,
  onOpenChange,
  technician,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  technician?: Technician;
  onDeleted?: () => void;
}) {
  const del = useDeleteTechnician();

  if (!technician) return null;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Remove ${technician.name}?`}
      description="They're signed out right away and stop receiving new jobs. Their past job history and proof stay on record."
      confirmLabel="Remove technician"
      isPending={del.isPending}
      onConfirm={() =>
        del.mutate(technician.id, {
          onSuccess: () => {
            toast.add({ title: `${technician.name} removed` });
            onOpenChange(false);
            onDeleted?.();
          },
        })
      }
    />
  );
}
