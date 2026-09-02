import { useState } from "react";
import { Plus } from "lucide-react";
import { PageMeta } from "@/components/shared/PageMeta";
import { CompanyFormDialog } from "@/components/superadmin/CompanyFormDialog";
import { CompanyTable } from "@/components/superadmin/CompanyTable";
import { Button } from "@/components/ui/button";
import { useCompanies } from "@/hooks/useCompanies";
import { useListParams } from "@/hooks/useListParams";

/**
 * Superadmin companies console. Thin by design: it wires the query string ⇄
 * the companies query ⇄ the table, and owns the "add" dialog. The table owns
 * the per-row edit / suspend / delete flows.
 */
export default function CompaniesPage() {
  const [params, setParams] = useListParams();
  const { data, isLoading, isError, error, refetch } = useCompanies(params);
  const [adding, setAdding] = useState(false);

  return (
    <>
      <PageMeta
        title="Companies"
        description="Create and manage companies (tenants)."
      />

      <div className="mb-4">
        <h1 className="text-lg font-semibold text-ink">Companies</h1>
        <p className="text-[13px] text-ink-2">
          Create a company and its first admin, and manage access.
        </p>
      </div>

      <CompanyTable
        companies={data?.rows}
        meta={data?.pagination}
        params={params}
        onParams={setParams}
        isLoading={isLoading}
        error={isError ? error : null}
        onRetry={() => refetch()}
        toolbarActions={
          <Button type="button" size="toolbar" onClick={() => setAdding(true)}>
            <Plus data-icon="inline-start" />
            Add company
          </Button>
        }
      />

      <CompanyFormDialog open={adding} onOpenChange={setAdding} />
    </>
  );
}
