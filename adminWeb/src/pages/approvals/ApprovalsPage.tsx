import { useState } from "react";
import { ApprovalTable } from "@/components/approvals/ApprovalTable";
import { ApproveProductDialog } from "@/components/approvals/ApproveProductDialog";
import { RejectProductDialog } from "@/components/approvals/RejectProductDialog";
import { PageMeta } from "@/components/shared/PageMeta";
import { useApprovals } from "@/hooks/useApprovals";
import { useUrlSeededListParams } from "@/hooks/useListParams";
import type { ProductSubmission } from "@/types/approval";

/**
 * Products vendors have submitted, waiting to be priced.
 *
 * A vendor may add products to their own book but not price them — what a
 * technician earns is withheld from a vendor, and what a vendor is charged is a
 * term between them and the company. So a submission arrives here unpriced and
 * unticketable, and a National Head or an Admin either sets both figures or
 * refuses it with a reason the vendor can act on.
 *
 * One discriminated union drives both dialogs, rather than two booleans plus a
 * "which row" ref that can disagree with each other.
 */
type OpenDialog =
  | { kind: "approve"; submission: ProductSubmission }
  | { kind: "reject"; submission: ProductSubmission }
  | null;

export default function ApprovalsPage() {
  /*
   * The page owns the query string; the table reports intent into it.
   *
   * `status` is seeded as a FILTER so a link can carry it — the notification
   * that brings somebody here points at the bare route, but a manager who has
   * filtered to Rejected can share what they are looking at.
   *
   * It starts EXPLICITLY on `pending` rather than relying on the server's
   * default for a missing value. The two agree, but the pill does not read the
   * server: `filterValue` falls back to the "All" sentinel when a filter is
   * unset, so an implicit default lit the All pill above a list that was only
   * ever the backlog — the screen stating one thing and showing another. A URL
   * carrying its own `status` still overrides this.
   */
  const [params, setParams] = useUrlSeededListParams(
    { filters: { status: "pending" } },
    ["status"]
  );
  const { data, isLoading, isError, error, refetch } = useApprovals(params);
  const [dialog, setDialog] = useState<OpenDialog>(null);

  return (
    <>
      <PageMeta
        title="Product approvals"
        description="Price and approve products vendors have submitted"
      />

      <h2 className="sr-only">Product approvals</h2>
      <ApprovalTable
        submissions={data?.rows}
        meta={data?.pagination}
        params={params}
        onParams={setParams}
        isLoading={isLoading}
        error={isError ? error : null}
        onRetry={() => refetch()}
        onApprove={(submission) => setDialog({ kind: "approve", submission })}
        onReject={(submission) => setDialog({ kind: "reject", submission })}
      />

      {/* Both dialogs close from their mutation's `onSuccess`, never on click,
          so a failure — including the 409 when a colleague decided the same row
          first — leaves the dialog standing over the toast. */}
      <ApproveProductDialog
        open={dialog?.kind === "approve"}
        onOpenChange={(open) => !open && setDialog(null)}
        submission={dialog?.kind === "approve" ? dialog.submission : undefined}
      />
      <RejectProductDialog
        open={dialog?.kind === "reject"}
        onOpenChange={(open) => !open && setDialog(null)}
        submission={dialog?.kind === "reject" ? dialog.submission : undefined}
      />
    </>
  );
}
