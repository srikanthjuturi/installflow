import { MoreHorizontal, Plus, Timer } from "lucide-react";
import {
  DataTable,
  type Column,
  type TypedFilterDef,
} from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SpeedRule } from "@/types/allowances";
import { speedRowView } from "./speedRows";

/** The Technician-type filter, kept in `?type=` by the view. */
export type SpeedTypeFilter = "all" | "employee" | "freelancer";

const TYPE_LABEL: Record<SpeedRule["technicianType"], string> = {
  employee: "Employee",
  freelancer: "Freelancer",
};

/**
 * The franchisee's speed matrix, one row per technician type × target.
 *
 * Client-side filtered and paged — the endpoint returns the whole matrix in
 * one response, so there is no server mode here. A rule's hint (what it
 * overrides, what overrides it) is the server's `overridesName` /
 * `overriddenBy`, worded by `speedRowView`.
 *
 * `readOnly` draws no actions and no Add button: the franchise-page card for a
 * non-home franchisee, and a staff reader without `settings.edit`.
 */
export function SpeedMatrixTable({
  rows,
  isLoading,
  error,
  onRetry,
  readOnly,
  type,
  onType,
  onAdd,
  onEdit,
  onRemove,
}: {
  rows?: SpeedRule[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  readOnly: boolean;
  type: SpeedTypeFilter;
  onType: (type: SpeedTypeFilter) => void;
  onAdd: () => void;
  onEdit: (rule: SpeedRule) => void;
  onRemove: (rule: SpeedRule) => void;
}) {
  const columns: Column<SpeedRule>[] = [
    {
      id: "target",
      header: "Applies to",
      cell: (r) => {
        const v = speedRowView(r);
        return (
          <div className="min-w-0">
            <div className="text-[13px] font-medium">{v.target}</div>
            {v.hint ? (
              <div className="mt-0.5 text-xs text-ink-3">{v.hint}</div>
            ) : null}
          </div>
        );
      },
    },
    {
      id: "type",
      header: "Type",
      cell: (r) => TYPE_LABEL[r.technicianType],
    },
    { id: "reward", header: "Reward", cell: (r) => speedRowView(r).reward },
    { id: "penalty", header: "Penalty", cell: (r) => speedRowView(r).penalty },
    ...(readOnly
      ? []
      : ([
          {
            id: "actions",
            header: "Actions",
            hideHeader: true,
            align: "right" as const,
            cell: (r) => {
              const target = speedRowView(r).target;
              return (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Actions for the ${target} rule (${TYPE_LABEL[r.technicianType]})`}
                      />
                    }
                  >
                    <MoreHorizontal aria-hidden />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-auto min-w-40 max-w-[calc(100vw-2rem)]"
                  >
                    <DropdownMenuItem onClick={() => onEdit(r)}>
                      Edit rule
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-danger"
                      onClick={() => onRemove(r)}
                    >
                      Remove rule
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            },
          },
        ] satisfies Column<SpeedRule>[])),
  ];

  const filters: TypedFilterDef<SpeedRule>[] = [
    {
      id: "type",
      label: "Technician type",
      variant: "pills",
      options: [
        { value: "all", label: "All" },
        { value: "employee", label: "Employees" },
        { value: "freelancer", label: "Freelancers" },
      ],
      value: type,
      onChange: (v) => onType(v as SpeedTypeFilter),
      allValue: "all",
      match: (r, v) => v === "all" || r.technicianType === v,
    },
  ];

  return (
    <DataTable
      errorTitle="Couldn't load the speed rules"
      caption="Speed rules by technician type and category or product"
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      filters={filters}
      minWidth="40rem"
      toolbarActions={
        readOnly ? undefined : (
          <Button type="button" size="toolbar" onClick={onAdd}>
            <Plus data-icon="inline-start" aria-hidden />
            Add rule
          </Button>
        )
      }
      emptyIcon={Timer}
      emptyTitle="No speed rules yet"
      emptyDescription="Add a rule for a category or a product. A job no rule matches earns and pays nothing for speed."
      filteredEmptyTitle="No rules for this type"
      filteredEmptyDescription="Try another technician type."
    />
  );
}
