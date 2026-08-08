import { useState } from "react";
import {
  DataTable,
  type Column,
} from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useSetCompanyStatus } from "@/hooks/useCompanies";
import { useParamsWriter, withSearch } from "@/hooks/useListParams";
import { cn } from "@/lib/utils";
import type { ListParams, PaginationMeta } from "@/types/api";
import type { Company } from "@/types/company";
import { CompanyFormDialog } from "./CompanyFormDialog";
import { DeleteCompanyDialog } from "./DeleteCompanyDialog";

function Monogram({ name }: { name: string }) {
  return (
    <div
      aria-hidden
      className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-3 text-xs font-semibold text-ink-2"
    >
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

interface CompanyTableProps {
  companies?: Company[];
  meta?: PaginationMeta;
  params: ListParams;
  onParams: (next: ListParams) => void;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  toolbarActions?: React.ReactNode;
}

export function CompanyTable({
  companies,
  meta,
  params,
  onParams,
  isLoading,
  error,
  onRetry,
  toolbarActions,
}: CompanyTableProps) {
  const [managed, setManaged] = useState<Company | undefined>(undefined);
  const [editOpen, setEditOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Company | undefined>(
    undefined
  );
  const [deleteOpen, setDeleteOpen] = useState(false);

  const write = useParamsWriter(params, onParams);
  const setStatus = useSetCompanyStatus();

  function toggleStatus(company: Company) {
    setStatus.mutate(
      { id: company.id, isActive: !company.isActive },
      {
        onSuccess: (saved) =>
          toast.add({
            title: `${saved.name} ${saved.isActive ? "activated" : "suspended"}`,
          }),
        onError: (err) =>
          toast.add({
            title: "Couldn't change status",
            description: err instanceof Error ? err.message : undefined,
          }),
      }
    );
  }

  const columns: Column<Company>[] = [
    {
      id: "name",
      header: "Company",
      cell: (c) => (
        <div className="flex items-center gap-2.5">
          <Monogram name={c.name} />
          <div className="leading-tight">
            <p className="font-medium text-ink">{c.name}</p>
            <p className="text-[11px] text-ink-3">{c.slug}</p>
          </div>
        </div>
      ),
    },
    {
      id: "gst",
      header: "GSTIN",
      cell: (c) => <span className="font-mono text-xs text-ink-2">{c.gstNumber}</span>,
    },
    {
      id: "email",
      header: "Contact",
      // The list payload carries the company's contact email; the specific
      // admin address (adminEmail) is only resolved on the detail/edit view.
      cell: (c) => (
        <span className="text-xs text-ink-2">{c.adminEmail ?? c.email}</span>
      ),
    },
    {
      id: "location",
      header: "Location",
      cell: (c) => (
        <div className="leading-tight">
          <p className="text-[13px] text-ink">
            {c.city}, {c.state}
          </p>
          <p className="text-[11px] tabular-nums text-ink-3">{c.pincode}</p>
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (c) => (
        <span
          className={cn(
            "inline-flex items-center gap-1.25 text-xs font-semibold",
            c.isActive ? "text-ok" : "text-warn"
          )}
        >
          <span aria-hidden className="size-1.75 rounded-full bg-current" />
          {c.isActive ? "Active" : "Suspended"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      hideHeader: true,
      align: "right",
      cell: (c) => (
        <div className="flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs font-semibold text-brand-400"
            onClick={() => {
              setManaged(c);
              setEditOpen(true);
            }}
          >
            Edit
            <span className="sr-only"> {c.name}</span>
          </Button>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs font-semibold text-ink-2"
            disabled={setStatus.isPending}
            onClick={() => toggleStatus(c)}
          >
            {c.isActive ? "Suspend" : "Activate"}
          </Button>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs font-semibold text-danger"
            onClick={() => {
              setPendingDelete(c);
              setDeleteOpen(true);
            }}
          >
            Delete
            <span className="sr-only"> {c.name}</span>
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <DataTable
        errorTitle="Couldn't load companies"
        caption="Companies (tenants), with their GSTIN, admin, location and status"
        data={companies}
        columns={columns}
        getRowId={(c) => c.id}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        search={{
          placeholder: "Search by name, email or GSTIN…",
          value: params.search ?? "",
          onChange: (v) => write((p) => withSearch(p, v)),
        }}
        server={{ meta, params, onParams }}
        toolbarActions={toolbarActions}
        minWidth="56rem"
        emptyTitle="No companies yet"
        emptyDescription="Create the first company and its admin to get started."
        emptyAction={toolbarActions}
        filteredEmptyTitle="No companies match that search"
        filteredEmptyDescription="Try a different name, email or GSTIN."
      />

      <CompanyFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        company={managed}
      />
      <DeleteCompanyDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        company={pendingDelete}
      />
    </>
  );
}
