import { Info } from "lucide-react";
import { ApiLogTable } from "@/components/integrations/ApiLogTable";
import { PageMeta } from "@/components/shared/PageMeta";
import { useApiCredentials, useApiLogs } from "@/hooks/useApiCredentials";
import { useListParams } from "@/hooks/useListParams";
import { useVendorOptions } from "@/hooks/useVendors";

const dateInput =
  "h-9 rounded-full border border-border bg-background px-3 text-[13px] text-ink-2";

/**
 * Every call a vendor's CRM made, newest first — Admin and National Head
 * (`integrations.manage`), this company only.
 *
 * The note above the table is deliberate. A call whose Client ID matches no
 * credential belongs to no company, so it is not stored here; an admin looking
 * for a vendor's failed sign-in with a mistyped ID would otherwise conclude
 * nothing was attempted.
 */
export default function ApiLogsPage() {
  const [params, setParams] = useListParams();
  const logs = useApiLogs(params);
  const vendors = useVendorOptions();
  const credentials = useApiCredentials();

  const f = params.filters ?? {};
  const setDate = (patch: { from?: string; to?: string }) => {
    const next = { ...params.filters, ...patch };
    if (!next.from) delete next.from;
    if (!next.to) delete next.to;
    setParams({ ...params, filters: next, page: 1 });
  };

  return (
    <>
      <PageMeta
        title="API logs"
        description="Every call a vendor's system made to you, and how it went"
      />
      <h2 className="sr-only">API logs</h2>

      <p className="mb-3.5 flex items-start gap-2 rounded-md bg-info-bg px-3 py-2.5 text-xs leading-relaxed text-info">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Calls made with an unrecognised Client ID are not listed — they belong
          to no vendor. Request details are kept for 30 days; the row itself for
          a year.
        </span>
      </p>

      <ApiLogTable
        rows={logs.data?.rows}
        meta={logs.data?.pagination}
        params={params}
        onParams={setParams}
        isLoading={logs.isLoading}
        isFetching={logs.isFetching && !logs.isLoading}
        error={logs.isError ? logs.error : null}
        onRetry={() => logs.refetch()}
        vendors={(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name }))}
        credentials={(credentials.data ?? []).map((c) => ({
          value: c.id,
          label: `${c.vendorName} · ${c.clientId}`,
        }))}
        toolbarActions={
          <div className="flex items-center gap-1.5 text-xs text-ink-2">
            <span className="whitespace-nowrap">Date</span>
            <input
              type="date"
              value={f.from ?? ""}
              max={f.to || undefined}
              onChange={(e) => setDate({ from: e.target.value })}
              aria-label="From date"
              className={dateInput}
            />
            <span aria-hidden>–</span>
            <input
              type="date"
              value={f.to ?? ""}
              min={f.from || undefined}
              onChange={(e) => setDate({ to: e.target.value })}
              aria-label="To date"
              className={dateInput}
            />
          </div>
        }
      />
    </>
  );
}
