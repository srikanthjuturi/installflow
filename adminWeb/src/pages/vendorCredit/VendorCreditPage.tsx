import { useState } from "react";
import { useSearchParams } from "react-router";
import { ApproveLimitDialog } from "@/components/vendorCredit/ApproveLimitDialog";
import { RecordPaymentDialog } from "@/components/vendorCredit/RecordPaymentDialog";
import { RejectVendorCreditDialog } from "@/components/vendorCredit/RejectVendorCreditDialog";
import { VendorLimitRequestTable } from "@/components/vendorCredit/VendorLimitRequestTable";
import { VendorPaymentTable } from "@/components/vendorCredit/VendorPaymentTable";
import { VendorStandingTable } from "@/components/vendorCredit/VendorStandingTable";
import { PageMeta } from "@/components/shared/PageMeta";
import { useListParams } from "@/hooks/useListParams";
import {
  useRejectLimitRequest,
  useVendorCreditCounts,
  useVendorLimitRequests,
  useVendorPayments,
  useVendorStandings,
} from "@/hooks/useVendorCredits";
import { cn } from "@/lib/utils";
import type { VendorCreditRequest, VendorStanding } from "@/types/vendorCredit";

/**
 * What this company's VENDORS owe it, and the two ways a vendor gets moving again.
 *
 * Admin and National Head only (`vendors.credit` plus a rank floor the server
 * holds): confirming a payment moves money and raising a line extends credit.
 *
 * ## Not the Credits screen
 *
 * `/credits` is what this company pays the PLATFORM for tickets entering the
 * system, charged when a ticket is raised. This is what its vendors owe IT for
 * work delivered, charged when a ticket closes. Separate tables, separate
 * numbers, and a vendor can be stopped by either — which is why they are two
 * screens and not two cards on one.
 *
 * ## Three lists, one on screen at a time
 *
 * **Vendors** is the standing list: every line and how much room is left.
 * **Payments** is the queue — a vendor says it paid, and somebody here decides.
 * **Limit requests** is the other remedy: a vendor asking for more room.
 *
 * Which one is `?view=` in the URL, as Credits and Approvals do it, and each
 * keeps its own filters.
 */
export default function VendorCreditPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get("view");
  const view: VendorCreditView =
    raw === "payments" || raw === "requests" ? raw : "vendors";
  const counts = useVendorCreditCounts();

  return (
    <>
      <PageMeta
        title="Vendor credit"
        description="What your vendors owe, their payments, and requests for a bigger limit"
      />
      <h2 className="sr-only">Vendor credit</h2>

      <ViewSwitch
        view={view}
        waiting={counts.data?.waiting ?? 0}
        pendingRequests={counts.data?.pendingRequests ?? 0}
        // Replaces the whole query string, as Credits does: each list keeps its
        // own filters, and carrying one's `?state=` into another would open it
        // narrowed for a reason nobody chose.
        onView={(next) =>
          setSearchParams(next === "vendors" ? {} : { view: next })
        }
      />

      {/* Keyed, so switching starts the next list from its own defaults rather
          than inheriting a page number from this one. */}
      {view === "payments" ? (
        <PaymentsList key="payments" />
      ) : view === "requests" ? (
        <RequestsList key="requests" />
      ) : (
        <VendorsList key="vendors" />
      )}
    </>
  );
}

type VendorCreditView = "vendors" | "payments" | "requests";

/**
 * Three buttons, not tabs — the same control as Credits and Approvals.
 *
 * The two queues carry a count; Vendors does not, because "how many vendors do
 * we have" is not work waiting for anybody. A zero is not drawn at all: a badge
 * reading 0 is a thing the eye still stops on.
 */
function ViewSwitch({
  view,
  waiting,
  pendingRequests,
  onView,
}: {
  view: VendorCreditView;
  waiting: number;
  pendingRequests: number;
  onView: (view: VendorCreditView) => void;
}) {
  const options: { value: VendorCreditView; label: string; count?: number }[] = [
    { value: "vendors", label: "Vendors" },
    { value: "payments", label: "Payments", count: waiting },
    { value: "requests", label: "Limit requests", count: pendingRequests },
  ];
  return (
    <div
      role="group"
      aria-label="What to show"
      className="mb-3.5 flex flex-wrap gap-2"
    >
      {options.map((o) => {
        const active = view === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onView(o.value)}
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded-lg border px-3.25 text-xs font-semibold whitespace-nowrap transition-colors",
              active
                ? "border-brand-500 bg-brand-500 text-white"
                : "border-input bg-surface text-ink-2 hover:border-brand-400 hover:text-ink"
            )}
          >
            {o.label}
            {o.count ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                  active ? "bg-white/20 text-white" : "bg-info-bg text-info"
                )}
              >
                {o.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function VendorsList() {
  const [params, setParams] = useListParams();
  const standings = useVendorStandings(params);
  const [recording, setRecording] = useState<VendorStanding | null>(null);
  return (
    <>
      <VendorStandingTable
        rows={standings.data?.rows}
        meta={standings.data?.pagination}
        params={params}
        onParams={setParams}
        isLoading={standings.isLoading}
        isFetching={standings.isFetching && !standings.isLoading}
        error={standings.isError ? standings.error : null}
        onRetry={() => standings.refetch()}
        onRecord={setRecording}
      />
      {/* Here rather than on the payment queue: recording one starts from the
          vendor whose line it clears, and the queue is for deciding claims the
          vendor made. */}
      <RecordPaymentDialog
        vendor={recording}
        onOpenChange={(open) => {
          if (!open) setRecording(null);
        }}
      />
    </>
  );
}

function PaymentsList() {
  const [params, setParams] = useListParams();
  const payments = useVendorPayments(params);
  return (
    <VendorPaymentTable
      rows={payments.data?.rows}
      meta={payments.data?.pagination}
      params={params}
      onParams={setParams}
      isLoading={payments.isLoading}
      isFetching={payments.isFetching && !payments.isLoading}
      error={payments.isError ? payments.error : null}
      onRetry={() => payments.refetch()}
      to={(r) => `/vendor-credit/payments/${r.id}`}
      showVendor
      backLabel="Back to vendor credit"
    />
  );
}

/**
 * Decided in place rather than on a page of its own, unlike a payment.
 *
 * A payment has a screenshot to look at and a UTR to match against a statement,
 * so it earns a page. A limit request is a number and a sentence: opening a
 * screen to read two facts and press one button is a step for nothing.
 */
function RequestsList() {
  const [params, setParams] = useListParams();
  const requests = useVendorLimitRequests(params);
  const [approving, setApproving] = useState<VendorCreditRequest | null>(null);
  const [rejecting, setRejecting] = useState<VendorCreditRequest | null>(null);
  const reject = useRejectLimitRequest();

  return (
    <>
      <VendorLimitRequestTable
        rows={requests.data?.rows}
        meta={requests.data?.pagination}
        params={params}
        onParams={setParams}
        isLoading={requests.isLoading}
        isFetching={requests.isFetching && !requests.isLoading}
        error={requests.isError ? requests.error : null}
        onRetry={() => requests.refetch()}
        onApprove={setApproving}
        onReject={setRejecting}
      />

      <ApproveLimitDialog
        request={approving}
        onOpenChange={(open) => {
          if (!open) setApproving(null);
        }}
      />

      <RejectVendorCreditDialog
        open={rejecting !== null}
        onOpenChange={(open) => {
          if (!open) setRejecting(null);
        }}
        title="Turn down the request?"
        description={`${rejecting?.vendorName ?? "This vendor"} will see your reason on their own Credit page. Their limit stays as it is, and they can ask again.`}
        placeholder="e.g. Settle the current balance first, then ask again."
        confirmLabel="Reject request"
        isPending={reject.isPending}
        onReject={(reason, onSuccess) => {
          if (!rejecting) return;
          reject.mutate({ id: rejecting.id, reason }, { onSuccess });
        }}
      />
    </>
  );
}
