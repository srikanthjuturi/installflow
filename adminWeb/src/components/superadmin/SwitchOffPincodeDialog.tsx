import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/components/ui/toast";
import { useSetPincodeActive } from "@/hooks/useGeo";
import type { GeoPincode } from "@/types/geo";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pincode?: GeoPincode;
}

/**
 * Switching a pincode off — the only removal there is.
 *
 * Never a delete. `tickets.pincode`, `technician_pincodes.pincode` and
 * `technician_invite_pincodes.pincode` all store the bare six characters with
 * no foreign key behind them, so removing the row would leave every one of them
 * resolving to nothing, silently, with no error for anybody to notice.
 *
 * Only this direction confirms. Switching one back on is not destructive, so it
 * fires straight from the dialog — see `PincodeChips`.
 */
export function SwitchOffPincodeDialog({ open, onOpenChange, pincode }: Props) {
  const setActive = useSetPincodeActive();
  if (!pincode) return null;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Switch off ${pincode.code}?`}
      description="Vendors will stop being offered it and new tickets on it will be refused. Tickets and technician coverage already on this pincode are untouched. Re-importing the sheet will not switch it back on — do that here."
      confirmLabel="Switch off"
      isPending={setActive.isPending}
      onConfirm={() =>
        setActive.mutate(
          { code: pincode.code, isActive: false },
          {
            // The dialog does not close itself: a failure has to leave it
            // standing over the toast that says why.
            onSuccess: () => {
              toast.add({ title: `${pincode.code} switched off` });
              onOpenChange(false);
            },
          }
        )
      }
    />
  );
}
