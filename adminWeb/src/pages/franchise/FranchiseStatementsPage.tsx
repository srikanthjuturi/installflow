import { useState } from "react";
import { useSearchParams } from "react-router";
import { PageMeta } from "@/components/shared/PageMeta";
import { LinkButton } from "@/components/shared/LinkButton";
import { toast } from "@/components/ui/toast";
import { EmployeeStatementTable } from "@/components/franchise/EmployeeStatementTable";
import {
  defaultStatementMonth,
  isStatementMonth,
} from "@/components/franchise/statements";
import type { Technician } from "@/types/technician";
import { useBrand } from "@/hooks/useBrand";
import { useMe } from "@/hooks/useAuth";
import { useStatementDownload } from "@/hooks/useFranchise";
import { useListParams } from "@/hooks/useListParams";
import { useTechnicians } from "@/hooks/useTechnicians";
import { useWorkspace } from "@/hooks/useWorkspace";

/**
 * Employee statements — the payroll handoff (§5.6).
 *
 * An employee gets no UPI redemptions: their travel, speed rewards, penalties
 * and bonuses land on a monthly CSV the franchisee's payroll adds to salary.
 * This screen is where that CSV is asked for — one month at a time, one
 * employee per file, the file named by `components/franchise/statements.ts`
 * because the server's `Content-Disposition` is not CORS-exposed.
 *
 * Not the staff technician list: employees only, registered only (an invite is
 * not a paid person yet), and the only action is download.
 */
export default function FranchiseStatementsPage() {
  const { paths } = useWorkspace();
  const { data: me } = useMe();
  const brand = useBrand();

  const [params, setParams] = useListParams();

  const [searchParams, setSearchParams] = useSearchParams();
  const monthParam = searchParams.get("month");

  // The default is the PREVIOUS IST month (`defaultStatementMonth`), the one
  // payroll actually works on. A hand-edited `?month=` is validated, not
  // trusted: anything but a real month falls back to the default rather than
  // sending the server a month it has no rows for.
  const month = isStatementMonth(monthParam)
    ? monthParam
    : defaultStatementMonth().value;

  const onMonth = (value: string) => {
    const url = new URLSearchParams(searchParams);
    url.set("month", value);
    setSearchParams(url, { replace: true });
  };

  // Registered employees ONLY — the same two filters the staff list's Type and
  // lifecycle support carry. They travel inside the fixed `filters` bag, not
  // the URL: this screen is reached as a destination, not deep-linked filtered.
  const list = useTechnicians({
    ...params,
    filters: { view: "registered", technicianType: "employee" },
  });
  const rows = list.data?.rows?.filter((t): t is Technician => t.registered);
  const meta = list.data?.pagination;

  const download = useStatementDownload();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const startDownload = (t: Technician) => {
    // A franchise session ALWAYS has a franchisee — `RequireFranchise` saw to
    // it — but the type cannot prove `/auth/me` has landed, and guessing a
    // name would put a wrong word in a payroll file.
    if (!me?.franchisee) return;
    setDownloadingId(t.id);
    download.mutate(
      {
        technicianId: t.id,
        code: t.code,
        month,
        company: brand.name,
        franchisee: me.franchisee.name,
      },
      {
        onSuccess: (input) => {
          toast.add({
            title: "Statement downloaded",
            description: `${t.name}, ${input.month}`,
          });
        },
        onSettled: () => setDownloadingId(null),
      }
    );
  };

  return (
    <>
      <PageMeta
        title="Employee statements"
        description="A month's allowances and penalties, per employee"
      />

      {/* The mock's amber note (`.note` in console.css) — payroll's context,
          read before the first Download click: what IS and is NOT in the file. */}
      <p className="mb-4 max-w-prose rounded-md border border-dashed border-warn bg-warn-bg px-3 py-2 text-[13px] leading-relaxed text-warn">
        Each statement lists the month's travel, speed rewards, penalties and
        bonuses for one employee, to add to their salary. Salary itself is not
        recorded here.
      </p>

      <EmployeeStatementTable
        rows={rows}
        meta={meta}
        params={params}
        onParams={setParams}
        month={month}
        onMonth={onMonth}
        isLoading={list.isLoading}
        isFetching={list.isFetching && !list.isLoading}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        downloadingId={downloadingId}
        onDownload={startDownload}
        emptyAction={
          // The remedy the empty copy names, one click away. Points at the
          // portal's own list, whose guard redirects to wherever this user
          // actually belongs if they hold no roster key.
          <LinkButton to={paths.technicians} size="sm">
            Go to Technicians
          </LinkButton>
        }
      />
    </>
  );
}