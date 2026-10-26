import { useState } from "react";
import { TemporaryPasswordPanel } from "@/components/shared/TemporaryPasswordPanel";
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
import { useReissueFacilityUserPassword } from "@/hooks/useFacilityUsers";
import type { FacilityUserSource } from "@/services/facilityUsers";
import type { CreatedFacilityUser, FacilityUser } from "@/types/parts";

/**
 * Email a facility user a fresh temporary password — Task 13 §5.7.
 *
 * `ReissueVendorPasswordDialog` / `ReissueFranchiseeAdminPasswordDialog`'s
 * two-phase shape exactly, which is why it is hand-rolled and not a
 * `ConfirmDialog`: after success it may swap its body for the temporary
 * password the email failed to carry, and a primitive should not own result
 * rendering. Never a toast for that password — it exists only in this response.
 *
 * The server revokes the person's sessions as part of the reissue.
 */
export function ReissueFacilityUserPasswordDialog({
  open,
  onOpenChange,
  source,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: FacilityUserSource;
  user?: FacilityUser;
}) {
  const reissue = useReissueFacilityUserPassword(source);
  const [undelivered, setUndelivered] = useState<CreatedFacilityUser | null>(null);

  function close() {
    onOpenChange(false);
    setTimeout(() => setUndelivered(null), 200);
  }

  const name = user?.fullName ?? "this user";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <DialogContent className="sm:max-w-md">
        {!user ? null : undelivered ? (
          <TemporaryPasswordPanel
            heading="Password reset, but the email didn't send"
            email={undelivered.email ?? ""}
            password={undelivered.temporaryPassword ?? ""}
            reason={undelivered.emailError}
            onDone={close}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Email {name} a new password?</DialogTitle>
              <DialogDescription>
                Their current password stops working and they are signed out
                everywhere.
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
                  reissue.mutate(user.membershipId, {
                    onSuccess: (saved) => {
                      if (saved.emailStatus === "failed") {
                        setUndelivered(saved);
                        return;
                      }
                      toast.add({ title: `New password emailed to ${name}` });
                      close();
                    },
                  })
                }
              >
                {reissue.isPending ? <Spinner data-icon="inline-start" /> : null}
                Email new password
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
