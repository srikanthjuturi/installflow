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
import { useReissueFranchiseeAdminPassword } from "@/hooks/useFranchisees";
import type { CreatedFranchiseeAdmin, FranchiseeAdmin } from "@/types/franchisee";

/**
 * Email a franchisee admin a fresh temporary password.
 *
 * A twin of `ReissueVendorPasswordDialog`, kept separate for the same reason
 * the vendor one forked `ReissueUserPassword`: the endpoint, the names on
 * screen and the portal the password belongs to all differ, and a `mode` prop
 * that reskins a password email is harder to read than two forms.
 *
 * It is the only way back in for an admin who never received the first email —
 * a staff console cannot reset a login it does not own, and password self-service
 * needs the password they may have lost.
 */
export function ReissueFranchiseeAdminPasswordDialog({
  open,
  onOpenChange,
  franchiseeId,
  franchiseeName,
  admin,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The ADMIN endpoint names both the franchisee and the membership. */
  franchiseeId: string;
  franchiseeName: string;
  admin?: FranchiseeAdmin;
}) {
  const reissue = useReissueFranchiseeAdminPassword();
  const [undelivered, setUndelivered] = useState<CreatedFranchiseeAdmin | null>(
    null
  );

  function close() {
    onOpenChange(false);
    setTimeout(() => setUndelivered(null), 200);
  }

  const name = admin?.fullName ?? "this admin";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <DialogContent className="sm:max-w-md">
        {!admin ? null : undelivered ? (
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
                {admin.email ?? "This admin"} will be signed out everywhere and
                will need the new password to sign in again. Their current one
                stops working.
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
                  reissue.mutate(
                    { franchiseeId, membershipId: admin.membershipId },
                    {
                      onSuccess: (saved) => {
                        if (saved.emailStatus === "failed") {
                          setUndelivered(saved);
                          return;
                        }
                        toast.add({
                          title: `New password emailed to ${saved.email}`,
                          description:
                            `${franchiseeName}'s admin has been signed out everywhere.`,
                        });
                        close();
                      },
                    }
                  )
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