import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { TemporaryPasswordPanel } from "@/components/shared/TemporaryPasswordPanel";
import { useReissueVendorPassword } from "@/hooks/useVendors";
import type { CreatedVendor, Vendor } from "@/types/vendor";

/**
 * Email a vendor's login a fresh temporary password.
 *
 * Replaces the password box that used to sit on the vendor form. It is the only
 * way back in for a vendor who has forgotten theirs — changing a password needs
 * the current one — and now the only way in for one who never received the
 * first email.
 *
 * Confirmed rather than fired from the row: it invalidates the password they
 * are using and signs them out of the portal everywhere.
 */
export function ReissueVendorPasswordDialog({
  open,
  onOpenChange,
  vendor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendor?: Vendor;
}) {
  const reissue = useReissueVendorPassword();
  const [undelivered, setUndelivered] = useState<CreatedVendor | null>(null);

  function close() {
    onOpenChange(false);
    setTimeout(() => setUndelivered(null), 200);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <DialogContent className="sm:max-w-md">
        {!vendor ? null : undelivered ? (
          <TemporaryPasswordPanel
            heading="Password reset, but the email didn't send"
            email={undelivered.loginEmail ?? ""}
            password={undelivered.temporaryPassword ?? ""}
            reason={undelivered.emailError}
            onDone={close}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Email {vendor.name} a new password?</DialogTitle>
              <DialogDescription>
                {vendor.loginEmail ?? "This vendor"} will be signed out of the
                portal everywhere and will need the new password to sign in
                again. Their current one stops working.
              </DialogDescription>
            </DialogHeader>

            {/* The failure is reported in the toaster (App.tsx), not here. */}
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>
                Cancel
              </DialogClose>
              <Button
                type="button"
                disabled={reissue.isPending}
                onClick={() =>
                  reissue.mutate(vendor.id, {
                    onSuccess: (saved) => {
                      if (saved.emailStatus === "failed") {
                        setUndelivered(saved);
                        return;
                      }
                      toast.add({
                        title: `New password emailed to ${saved.loginEmail}`,
                        description: `${saved.name} has been signed out of the portal everywhere.`,
                      });
                      close();
                    },
                  })
                }
              >
                {reissue.isPending ? <Spinner data-icon="inline-start" /> : null}
                Email a new password
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
