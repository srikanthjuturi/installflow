import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  approveLimitRequest,
  askForLimit,
  cancelMyPayment,
  claimMyPayment,
  confirmVendorPayment,
  getMyCredit,
  getMyPayment,
  getVendorCreditCounts,
  getVendorPayment,
  getVendorStanding,
  listMyCreditEntries,
  listMyLimitRequests,
  listMyPayments,
  listVendorLimitRequests,
  listVendorPayments,
  listVendorStandings,
  recordVendorPayment,
  rejectLimitRequest,
  rejectVendorPayment,
  startMyPayment,
  withdrawLimitRequest,
} from "@/services/vendorCredits";
import type { ListParams } from "@/types/api";
import type { VendorPaymentDetail } from "@/types/vendorCredit";

/**
 * One prefix for the whole slice, so a payment decided on the other side of it —
 * which reaches this client only as a bell (`notification.raised`, see
 * `useTicketStream`) — refreshes the line, the statement and the queues together.
 *
 * `["vendors"]` is invalidated alongside it by the writers below, because
 * `VendorOut` carries the same four figures for the Vendors screen's Credit
 * column. Two screens reading one fact must not disagree after a write.
 */
export const vendorCreditKeys = {
  all: ["vendor-credit"] as const,
  mine: () => ["vendor-credit", "mine"] as const,
  myEntries: (params: ListParams) =>
    ["vendor-credit", "my-entries", params] as const,
  myPayments: (params: ListParams) =>
    ["vendor-credit", "my-payments", params] as const,
  myPayment: (id: string) => ["vendor-credit", "my-payment", id] as const,
  myRequests: () => ["vendor-credit", "my-requests"] as const,
  counts: () => ["vendor-credit", "counts"] as const,
  standings: (params: ListParams) =>
    ["vendor-credit", "standings", params] as const,
  standing: (vendorId: string) =>
    ["vendor-credit", "standing", vendorId] as const,
  payments: (params: ListParams) => ["vendor-credit", "payments", params] as const,
  payment: (id: string) => ["vendor-credit", "payment", id] as const,
  requests: (params: ListParams) => ["vendor-credit", "requests", params] as const,
};

// ── the vendor's own side ────────────────────────────────────────────────────

export function useMyCredit({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: vendorCreditKeys.mine(),
    queryFn: getMyCredit,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    enabled,
  });
}

export function useMyCreditEntries(params: ListParams) {
  return useQuery({
    queryKey: vendorCreditKeys.myEntries(params),
    queryFn: () => listMyCreditEntries(params),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

export function useMyVendorPayments(params: ListParams) {
  return useQuery({
    queryKey: vendorCreditKeys.myPayments(params),
    queryFn: () => listMyPayments(params),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

/**
 * One of the vendor's own payments. `staleTime: 0` because the screenshot link
 * inside it is signed for fifteen minutes — the reason `useRecharge` gives.
 */
export function useMyVendorPayment(id: string) {
  return useQuery({
    queryKey: vendorCreditKeys.myPayment(id),
    queryFn: () => getMyPayment(id),
    enabled: !!id,
    staleTime: 0,
    gcTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useMyLimitRequests({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: vendorCreditKeys.myRequests(),
    queryFn: listMyLimitRequests,
    staleTime: 10_000,
    enabled,
  });
}

/**
 * The vendor's own writes. Seeds the detail cache from the reply and then clears
 * the slice, so the line on the same screen moves with the payment.
 */
function useMyPaymentWrite<TVars>(
  fn: (vars: TVars) => Promise<VendorPaymentDetail>,
  errorTitle: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle },
    mutationFn: fn,
    onSuccess: (detail) => {
      queryClient.setQueryData(vendorCreditKeys.myPayment(detail.id), detail);
      void queryClient.invalidateQueries({ queryKey: vendorCreditKeys.all });
      // The banner over the vendor's ticket form reads this, and a confirmed
      // payment is exactly when it should stop saying "paused".
      void queryClient.invalidateQueries({ queryKey: ["tickets-intake-status"] });
    },
  });
}

export const useStartMyPayment = () =>
  useMyPaymentWrite(startMyPayment, "Couldn't start the payment");

export const useClaimMyPayment = () =>
  useMyPaymentWrite(claimMyPayment, "Couldn't submit the payment");

export const useCancelMyPayment = () =>
  useMyPaymentWrite(cancelMyPayment, "Couldn't withdraw the payment");

function useMyRequestWrite<TVars, TOut>(
  fn: (vars: TVars) => Promise<TOut>,
  errorTitle: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle },
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: vendorCreditKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["tickets-intake-status"] });
    },
  });
}

export const useAskForLimit = () =>
  useMyRequestWrite(askForLimit, "Couldn't send the request");

export const useWithdrawLimitRequest = () =>
  useMyRequestWrite(withdrawLimitRequest, "Couldn't withdraw the request");

// ── the staff side ──────────────────────────────────────────────────────────

/**
 * The rail badges. Polled like the escalation queue's: nothing sweeps these, so
 * they only move as people work them, and a socket frame arrives only when this
 * console's own user is in the bell's audience.
 */
export function useVendorCreditCounts({
  enabled = true,
}: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: vendorCreditKeys.counts(),
    queryFn: getVendorCreditCounts,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    enabled,
  });
}

export function useVendorStandings(params: ListParams) {
  return useQuery({
    queryKey: vendorCreditKeys.standings(params),
    queryFn: () => listVendorStandings(params),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

export function useVendorStanding(vendorId: string) {
  return useQuery({
    queryKey: vendorCreditKeys.standing(vendorId),
    queryFn: () => getVendorStanding(vendorId),
    enabled: !!vendorId,
    staleTime: 10_000,
  });
}

export function useVendorPayments(params: ListParams) {
  return useQuery({
    queryKey: vendorCreditKeys.payments(params),
    queryFn: () => listVendorPayments(params),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

/** One payment. `staleTime: 0` — the screenshot link is signed for fifteen minutes. */
export function useVendorPayment(id: string) {
  return useQuery({
    queryKey: vendorCreditKeys.payment(id),
    queryFn: () => getVendorPayment(id),
    enabled: !!id,
    staleTime: 0,
    gcTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useVendorLimitRequests(params: ListParams) {
  return useQuery({
    queryKey: vendorCreditKeys.requests(params),
    queryFn: () => listVendorLimitRequests(params),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

/**
 * The staff writes. Each clears the slice AND the Vendors screen, because
 * `VendorOut` carries the same four figures for its Credit column — confirming a
 * payment here must not leave a stale "owed" there.
 */
function useVendorCreditWrite<TVars, TOut extends { id: string }>(
  fn: (vars: TVars) => Promise<TOut>,
  errorTitle: string,
  detailKey?: (id: string) => readonly unknown[]
) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle },
    mutationFn: fn,
    onSuccess: (row) => {
      if (detailKey) queryClient.setQueryData(detailKey(row.id), row);
      void queryClient.invalidateQueries({ queryKey: vendorCreditKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["vendors"] });
    },
  });
}

/**
 * Recording money that came by NEFT, RTGS, cheque or cash.
 *
 * Goes through the same writer as Confirm, and for the same reason: it moves the
 * line, so the Vendors screen's Credit column has to be re-read too.
 */
export const useRecordVendorPayment = () =>
  useVendorCreditWrite(
    recordVendorPayment,
    "Couldn't record the payment",
    vendorCreditKeys.payment
  );

export const useConfirmVendorPayment = () =>
  useVendorCreditWrite(
    confirmVendorPayment,
    "Couldn't confirm the payment",
    vendorCreditKeys.payment
  );

export const useRejectVendorPayment = () =>
  useVendorCreditWrite(
    rejectVendorPayment,
    "Couldn't reject the payment",
    vendorCreditKeys.payment
  );

export const useApproveLimitRequest = () =>
  useVendorCreditWrite(approveLimitRequest, "Couldn't approve the request");

export const useRejectLimitRequest = () =>
  useVendorCreditWrite(rejectLimitRequest, "Couldn't reject the request");
