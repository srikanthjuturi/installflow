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
import { useApproveBrand } from "@/hooks/useApprovals";
import type { BrandSubmission } from "@/types/approval";

/**
 * Say yes to a vendor's brand.
 *
 * Not `ConfirmDialog`: that one is for destructive acts and draws a red
 * button, and agreeing a vendor sells something is not one. Nothing to type —
 * a brand has no price — so it is a sentence and a button.
 *
 * Closes from `onSuccess`, never on click, so a failure (including the 409
 * when a colleague decided it first) leaves it standing over the toast.
 */
export function ApproveBrandDialog({
  open,
  onOpenChange,
  submission,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submission?: BrandSubmission;
}) {
  const approve = useApproveBrand();

  function confirm() {
    if (!submission) return;
    approve.mutate(submission.id, {
      onSuccess: () => {
        toast.add({
          title: `${submission.name} approved`,
          description: `${submission.vendorName} can put it on its products now.`,
        });
        onOpenChange(false);
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {submission ? (
          <>
            <DialogHeader>
              <DialogTitle>Approve {submission.name}?</DialogTitle>
              <DialogDescription>
                {submission.vendorName} will be able to put {submission.name} on
                the products it adds. Its products are still priced one by one.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose
                render={
                  <Button
                    type="button"
                    variant="outline"
                    disabled={approve.isPending}
                  />
                }
              >
                Cancel
              </DialogClose>
              <Button
                type="button"
                disabled={approve.isPending}
                onClick={confirm}
              >
                {approve.isPending ? <Spinner data-icon="inline-start" /> : null}
                Approve brand
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
