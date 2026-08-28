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
import { useReissueUserPassword } from "@/hooks/useCompanyUsers";
import type { CompanyUser, CreatedCompanyUser } from "@/types/user";

/**
 * Email a member a fresh temporary password.
 *
 * The way back in for somebody who never received the first one — it landed in
 * spam, or the address has a typo that still validates. Without this the
 * account is unreachable by anyone: staff have no password reset, and changing
 * a password requires knowing the current one.
 *
 * Confirmed rather than fired from the row, because it invalidates the password
 * they are currently using AND signs them out everywhere. Not something to hit
 * by accident next to "Edit access".
 */
export function ReissuePasswordDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: CompanyUser;
}) {
  const reissue = useReissueUserPassword();
  // Set when the new password could not be emailed — the dialog then shows it
  // instead of the confirmation. See TemporaryPasswordPanel for why not a toast.
  const [undelivered, setUndelivered] = useState<CreatedCompanyUser | null>(
    null
  );

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
        {!user ? null : undelivered ? (
          <TemporaryPasswordPanel
            heading="Password reset, but the email didn't send"
            email={undelivered.email}
            password={undelivered.temporaryPassword ?? ""}
            reason={undelivered.emailError}
            onDone={close}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                Email {user.fullName ?? user.email} a new password?
              </DialogTitle>
              <DialogDescription>
                {user.email} will be signed out everywhere and will need the new
                password to sign in again. Their current one stops working.
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
                    onSuccess: (u) => {
                      if (u.emailStatus === "failed") {
                        setUndelivered(u);
                        return;
                      }
                      toast.add({
                        title: `New password emailed to ${u.email}`,
                        description: `${u.fullName ?? u.email} has been signed out everywhere.`,
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
