import { useState } from "react";
import { Package, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { useSetPartsAddress } from "@/hooks/useTechnicians";
import { formatDateTime } from "@/utils/datetime";
import { formatPhone } from "@/utils/phone";
import type { Technician } from "@/types/technician";
import { PartsAddressDialog } from "./PartsAddressDialog";

/**
 * Where spare parts are delivered for this technician (Epic 6). Under the Base
 * location card, on both surfaces.
 *
 * The server sends `partsAddress` only to a caller who can manage the
 * technician, so `undefined` means "not yours to see" and the card stays out
 * of the way; `null` means nothing is saved.
 *
 * `canEdit` is the page's own gate (edit key AND `canManage`); hiding the
 * buttons is presentation, the server refuses a write regardless (hard rule 8).
 */
export function PartsAddressPanel({
  tech,
  canEdit,
}: {
  tech: Technician;
  canEdit: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const save = useSetPartsAddress();
  const address = tech.partsAddress ?? null;

  if (tech.partsAddress === undefined && !canEdit) return null;

  const remove = async () => {
    try {
      await save.mutateAsync({ id: tech.id, body: null });
      toast.add({ title: "Parts address removed" });
      setRemoveOpen(false);
    } catch {
      /* The global handler has toasted it; the dialog stays. */
    }
  };

  return (
    <Card>
      <CardContent>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[11px] font-bold tracking-[0.04em] text-ink-3 uppercase">
              Parts address
            </h3>
            <p className="mt-1 text-xs text-ink-3">
              Where spare parts for this technician are delivered.
            </p>
          </div>
          {canEdit ? (
            <div className="flex shrink-0 items-center gap-2">
              {address ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-danger"
                  onClick={() => setRemoveOpen(true)}
                >
                  <Trash2 data-icon="inline-start" aria-hidden />
                  Remove
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditOpen(true)}
              >
                <Package data-icon="inline-start" aria-hidden />
                {address ? "Change" : "Add parts address"}
              </Button>
            </div>
          ) : null}
        </div>

        {address ? (
          <div className="mt-3 flex flex-col gap-1">
            <address className="text-[13px] font-medium not-italic wrap-anywhere">
              <span className="block">{address.line}</span>
              {address.landmark ? (
                <span className="block">Landmark: {address.landmark}</span>
              ) : null}
              <span className="block">
                {address.city} - {address.pincode}
              </span>
            </address>
            <span className="text-xs text-ink-2">
              {address.contactPhone
                ? `Phone: ${formatPhone(address.contactPhone)}`
                : "Phone: the technician's own"}
            </span>
            <span className="text-xs text-ink-3">
              Saved {formatDateTime(address.setAt)}
            </span>
          </div>
        ) : (
          <p className="mt-3 rounded-md bg-surface-3 px-3 py-2 text-xs text-ink-2">
            No parts address saved. Parts then go to the technician&apos;s base
            area.
          </p>
        )}
      </CardContent>

      {canEdit ? (
        <>
          <PartsAddressDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            technicianId={tech.id}
            technicianName={tech.name}
            saved={address}
          />
          <ConfirmDialog
            open={removeOpen}
            onOpenChange={setRemoveOpen}
            title="Remove the parts address?"
            description="Parts requests they raise from now on go to their base area. Requests already raised keep the address they were raised with."
            confirmLabel="Remove address"
            onConfirm={remove}
            isPending={save.isPending}
          />
        </>
      ) : null}
    </Card>
  );
}
