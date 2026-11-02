import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  getCompanyRollup,
  getStatement,
  getStatementCsv,
  getTransaction,
  getTransactionSummary,
  listTransactionParties,
  listTransactions,
  resendDocumentEmails,
  type ResendInput,
  type StatementQuery,
} from "@/services/transactions";
import { listCompanies } from "@/services/companies";
import type { PartyKind, TransactionQuery } from "@/types/transaction";
import { companyKeys } from "./useCompanies";

/** One prefix, so a re-send clears the list, the cards and the drawer together. */
export const transactionKeys = {
  all: ["transactions"] as const,
  list: (q: TransactionQuery, page: number, limit: number) =>
    ["transactions", "list", q, page, limit] as const,
  summary: (q: TransactionQuery) => ["transactions", "summary", q] as const,
  parties: (companyId: string | undefined, kind: PartyKind | undefined) =>
    ["transactions", "parties", companyId ?? null, kind ?? null] as const,
  statement: (q: StatementQuery) => ["transactions", "statement", q] as const,
  rollup: (from: string, to: string) =>
    ["transactions", "rollup", from, to] as const,
};

export function useTransactionList(
  q: TransactionQuery,
  page: number,
  limit: number,
  enabled = true
) {
  return useQuery({
    queryKey: transactionKeys.list(q, page, limit),
    queryFn: () => listTransactions(q, { page, limit }),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    enabled,
  });
}

export function useTransactionSummary(q: TransactionQuery, enabled = true) {
  return useQuery({
    queryKey: transactionKeys.summary(q),
    queryFn: () => getTransactionSummary(q),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    enabled,
  });
}

export function useTransactionParties(
  opts: { companyId?: string; partyKind?: PartyKind; enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: transactionKeys.parties(opts.companyId, opts.partyKind),
    queryFn: () =>
      listTransactionParties({
        companyId: opts.companyId,
        partyKind: opts.partyKind,
      }),
    staleTime: 60_000,
    enabled: opts.enabled ?? true,
  });
}

export function useStatement(q: StatementQuery | null) {
  return useQuery({
    queryKey: transactionKeys.statement(
      q ?? { partyKind: "platform", from: "", to: "" }
    ),
    queryFn: () => getStatement(q as StatementQuery),
    enabled: q !== null,
    staleTime: 10_000,
    // A 422 (bad period, company required) is an answer, not a flake.
    retry: false,
  });
}

export function useCompanyRollup(
  range: { from: string; to: string } | null,
  enabled = true
) {
  return useQuery({
    queryKey: transactionKeys.rollup(range?.from ?? "", range?.to ?? ""),
    queryFn: () => getCompanyRollup(range as { from: string; to: string }),
    enabled: enabled && range !== null,
    staleTime: 10_000,
    retry: false,
  });
}

export function useDownloadStatementCsv() {
  return useMutation({
    meta: { errorTitle: "Couldn't download the statement" },
    mutationFn: (q: StatementQuery) => getStatementCsv(q),
  });
}

export function useResendEmails() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn't queue the documents" },
    mutationFn: (input: ResendInput) => resendDocumentEmails(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: transactionKeys.all });
    },
  });
}

/** One document - the drawer's related-document lookup. */
export function useTransactionDocument(id: string | null) {
  return useQuery({
    queryKey: ["transactions", "document", id] as const,
    queryFn: () => getTransaction(id as string),
    enabled: id !== null,
    staleTime: 30_000,
  });
}

const COMPANY_OPTIONS_PARAMS = { page: 1, limit: 100 } as const;

/**
 * Every company, for the superadmin's company filter. The same query key as the
 * Companies screen's first page, so opening one warms the other.
 */
export function useCompanyOptions(enabled: boolean) {
  return useQuery({
    queryKey: companyKeys.page(COMPANY_OPTIONS_PARAMS),
    queryFn: () => listCompanies(COMPANY_OPTIONS_PARAMS),
    select: (page) => page.rows.map((c) => ({ id: c.id, name: c.name })),
    staleTime: 5 * 60_000,
    enabled,
  });
}
