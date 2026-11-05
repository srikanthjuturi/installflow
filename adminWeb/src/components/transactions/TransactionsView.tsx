import { useState } from "react";
import { Mail } from "lucide-react";
import { PageMeta } from "@/components/shared/PageMeta";
import { Button } from "@/components/ui/button";
import {
  useTransactionFilters,
  type TransactionTab,
} from "@/hooks/useTransactionFilters";
import {
  useCompanyOptions,
  useCompanyRollup,
  useTransactionList,
  useTransactionParties,
  useTransactionSummary,
} from "@/hooks/useTransactions";
import type { DateRange, PeriodPreset } from "@/lib/transactionPeriod";
import { cn } from "@/lib/utils";
import {
  SURFACE_CAPS,
  type CompanyRollup,
  type TransactionDocument,
  type TransactionSurface,
} from "@/types/transaction";
import { DocumentDrawer } from "./DocumentDrawer";
import { PeriodBar } from "./PeriodBar";
import { ResendEmailDialog } from "./ResendEmailDialog";
import { RollupTable } from "./RollupTable";
import { StatementPanel } from "./StatementPanel";
import { TransactionKpis } from "./TransactionKpis";
import { TransactionTable } from "./TransactionTable";

const COPY: Record<TransactionSurface, { title: string; lede: string }> = {
  superadmin: {
    title: "Transactions",
    lede: "Every numbered document across companies - invoices, receipts, payments and notes - with statements and the email each company's Admins receive.",
  },
  company: {
    title: "Transactions",
    lede: "Every numbered document for this company - invoices, receipts, payments and notes - with statements per vendor, franchisee, technician and the platform.",
  },
  vendor: {
    title: "Documents",
    lede: "Your invoices, receipts and notes, and your statement of account with the company.",
  },
  franchise: {
    title: "Documents",
    lede: "Your franchise's documents and your technicians' - and your statement of account with the company.",
  },
};

/**
 * The Transactions dashboard, once, for all four surfaces: the super-admin
 * console, the company console (Admin / National Head), the vendor portal and
 * the franchise portal. What each may see is `SURFACE_CAPS`; the SERVER decides
 * the scope from the caller, so nothing here is authorization (hard rule 8).
 *
 * The whole view is in the URL - period, filters, search, page, tab - so a
 * view is a link.
 */
export function TransactionsView({ surface }: { surface: TransactionSurface }) {
  const caps = SURFACE_CAPS[surface];
  const { state, patch, query } = useTransactionFilters();
  const [open, setOpen] = useState<TransactionDocument | null>(null);
  const [resending, setResending] = useState(false);

  const isSuperadmin = surface === "superadmin";
  const documents = state.tab === "documents";

  const companies = useCompanyOptions(isSuperadmin);
  const list = useTransactionList(query, state.page, state.limit, documents);
  const summary = useTransactionSummary(query, documents);
  const parties = useTransactionParties({
    companyId: isSuperadmin ? state.companyId : undefined,
    partyKind: state.partyKind,
    enabled: documents && caps.partyFilter,
  });
  const rollup = useCompanyRollup(
    state.range,
    caps.rollup && state.tab === "statement"
  );

  const onPreset = (preset: PeriodPreset) =>
    patch({
      p: preset,
      ...(preset === "custom"
        ? { from: state.range.from, to: state.range.to }
        : {}),
    });
  const onCustom = (range: DateRange) =>
    patch({ p: "custom", from: range.from, to: range.to });

  const openStatementFor = (row: CompanyRollup) =>
    patch({ company: row.companyId, sk: "platform", sp: undefined });

  const copy = COPY[surface];
  const tabs: { value: TransactionTab; label: string }[] = [
    { value: "documents", label: "Documents" },
    { value: "statement", label: "Statement" },
  ];

  return (
    <>
      <PageMeta title={copy.title} description={copy.lede} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13px] text-ink-2">{copy.lede}</p>
        {caps.email ? (
          <Button type="button" variant="outline" onClick={() => setResending(true)}>
            <Mail data-icon="inline-start" aria-hidden />
            Re-send by email
          </Button>
        ) : null}
      </div>

      <PeriodBar
        preset={state.preset}
        range={state.range}
        onPreset={onPreset}
        onCustom={onCustom}
      />

      <div role="group" aria-label="What to show" className="mb-3.5 flex flex-wrap gap-2">
        {tabs.map((t) => {
          const active = state.tab === t.value;
          return (
            <button
              key={t.value}
              type="button"
              aria-pressed={active}
              onClick={() => patch({ tab: t.value })}
              className={cn(
                "inline-flex h-10 items-center gap-2 rounded-lg border px-3.25 text-xs font-semibold whitespace-nowrap transition-colors",
                active
                  ? "border-brand-500 bg-brand-500 text-white"
                  : "border-input bg-surface text-ink-2 hover:border-brand-400 hover:text-ink"
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {documents ? (
        <>
          <TransactionKpis
            summary={summary.data}
            isLoading={summary.isLoading}
            error={summary.isError ? summary.error : null}
            onRetry={() => summary.refetch()}
          />
          <TransactionTable
            surface={surface}
            state={state}
            patch={patch}
            rows={list.data?.rows}
            meta={list.data?.pagination}
            isLoading={list.isLoading}
            // A refetch dims the rows; keepPreviousData means the table never
            // blanks, so this is the only signal of a slow page.
            isFetching={list.isFetching && !list.isLoading}
            error={list.isError ? list.error : null}
            onRetry={() => list.refetch()}
            parties={parties.data}
            companies={companies.data}
            onOpen={setOpen}
          />
        </>
      ) : (
        <>
          {caps.rollup ? (
            <RollupTable
              rows={rollup.data}
              isLoading={rollup.isLoading}
              error={rollup.isError ? rollup.error : null}
              onRetry={() => rollup.refetch()}
              onOpenStatement={openStatementFor}
            />
          ) : null}
          <StatementPanel
            surface={surface}
            state={state}
            patch={patch}
            companies={companies.data}
          />
        </>
      )}

      <DocumentDrawer
        surface={surface}
        doc={open}
        onClose={() => setOpen(null)}
        onOpenRelated={setOpen}
      />

      {resending ? (
        <ResendEmailDialog
          open
          onOpenChange={(o) => !o && setResending(false)}
          range={state.range}
          isSuperadmin={isSuperadmin}
          companies={companies.data}
          companyId={state.companyId}
        />
      ) : null}
    </>
  );
}

