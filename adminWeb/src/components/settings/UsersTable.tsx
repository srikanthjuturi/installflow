import { useState } from "react";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  useMyRank,
  useRoles,
  useUpdateUser,
} from "@/hooks/useCompanyUsers";
import { useParamsWriter, withSearch } from "@/hooks/useListParams";
import { cn } from "@/lib/utils";
import type { ListParams, PaginationMeta } from "@/types/api";
import type { CompanyUser } from "@/types/user";
import { DeleteUserDialog } from "./DeleteUserDialog";
import { EditUserDialog } from "./EditUserDialog";

function initialsOf(user: CompanyUser): string {
  const base = user.fullName?.trim() || user.email;
  const parts = base.split(/[\s@._-]+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "");
  return letters.toUpperCase();
}

// Avatar photos will come from blob storage later; initials stand in for now.
function Avatar({ user }: { user: CompanyUser }) {
  return (
    <div
      aria-hidden
      className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-100 text-[11px] font-semibold text-brand-500"
    >
      {initialsOf(user)}
    </div>
  );
}

interface UsersTableProps {
  users?: CompanyUser[];
  meta?: PaginationMeta;
  params: ListParams;
  onParams: (next: ListParams) => void;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  toolbarActions?: React.ReactNode;
}

export function UsersTable({
  users,
  meta,
  params,
  onParams,
  isLoading,
  error,
  onRetry,
  toolbarActions,
}: UsersTableProps) {
  const [managed, setManaged] = useState<CompanyUser | undefined>(undefined);
  const [editOpen, setEditOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CompanyUser | undefined>(
    undefined
  );
  const [deleteOpen, setDeleteOpen] = useState(false);

  const write = useParamsWriter(params, onParams);
  const update = useUpdateUser();
  const myRank = useMyRank();
  const { data: roles } = useRoles();
  const rankOf = (roleKey: string) =>
    roles?.find((r) => r.key === roleKey)?.rank ?? -Infinity;

  function toggleStatus(u: CompanyUser) {
    update.mutate(
      { id: u.membershipId, input: { isActive: !u.isActive } },
      {
        onSuccess: (saved) =>
          toast.add({
            title: `${saved.fullName ?? saved.email} ${saved.isActive ? "activated" : "suspended"}`,
          }),
        onError: (e) =>
          toast.add({
            title: "Couldn't change status",
            description: e instanceof Error ? e.message : undefined,
          }),
      }
    );
  }

  const columns: Column<CompanyUser>[] = [
    {
      id: "user",
      header: "User",
      cell: (u) => (
        <div className="flex items-center gap-2.5">
          <Avatar user={u} />
          <div className="leading-tight">
            <p className="font-medium text-ink">{u.fullName ?? "—"}</p>
            <p className="text-[11px] text-ink-3">{u.email}</p>
          </div>
        </div>
      ),
    },
    {
      id: "role",
      header: "Role",
      cell: (u) => (
        <span className="inline-block rounded-full bg-brand-100 px-2.25 py-0.75 text-[11px] font-semibold text-brand-500">
          {u.roleLabel}
        </span>
      ),
    },
    {
      id: "scope",
      header: "Scope",
      cell: (u) => (
        <div className="leading-tight">
          <p className="text-[13px] text-ink">{u.scopeLabel}</p>
          {/* `scopeLabel` counts the states; this names the first few, the
              way it used to name the first few pincodes. */}
          {u.states.length ? (
            <p className="text-[11px] text-ink-3">
              {u.states
                .slice(0, 3)
                .map((s) => s.name)
                .join(", ")}
              {u.states.length > 3 ? ` +${u.states.length - 3}` : ""}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      id: "phone",
      header: "Phone",
      cell: (u) =>
        u.phone ? (
          <span className="text-xs tabular-nums text-ink-2">{u.phone}</span>
        ) : (
          <span className="text-xs text-ink-3">
            <span aria-hidden>—</span>
            <span className="sr-only">No phone</span>
          </span>
        ),
    },
    {
      id: "appointedBy",
      header: "Appointed by",
      // The manager who appointed them (`created_by`), not who they report to.
      // Nullable — a system-seeded row has nobody, and reads as a dash the same
      // way an absent phone does.
      cell: (u) =>
        u.appointedBy ? (
          <span className="text-[13px] text-ink-2">{u.appointedBy}</span>
        ) : (
          <span className="text-xs text-ink-3">
            <span aria-hidden>—</span>
            <span className="sr-only">Not recorded</span>
          </span>
        ),
    },
    {
      id: "status",
      header: "Status",
      cell: (u) => (
        <span
          className={cn(
            "inline-flex items-center gap-1.25 text-xs font-semibold",
            u.isActive ? "text-ok" : "text-warn"
          )}
        >
          <span aria-hidden className="size-1.75 rounded-full bg-current" />
          {u.isActive ? "Active" : "Suspended"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      hideHeader: true,
      align: "right",
      cell: (u) => {
        // Only users strictly below your rank can be managed — matches the
        // backend rule (you can't edit peers, superiors, or yourself).
        if (rankOf(u.role) <= myRank) {
          return (
            <span className="text-xs text-ink-3">
              <span aria-hidden>—</span>
              <span className="sr-only">No actions available</span>
            </span>
          );
        }
        return (
          <div className="flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs font-semibold text-brand-400"
              onClick={() => {
                setManaged(u);
                setEditOpen(true);
              }}
            >
              Edit access
              <span className="sr-only"> for {u.fullName ?? u.email}</span>
            </Button>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs font-semibold text-ink-2"
              disabled={update.isPending}
              onClick={() => toggleStatus(u)}
            >
              {u.isActive ? "Suspend" : "Activate"}
            </Button>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs font-semibold text-danger"
              onClick={() => {
                setPendingDelete(u);
                setDeleteOpen(true);
              }}
            >
              Remove
              <span className="sr-only"> {u.fullName ?? u.email}</span>
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <>
      <DataTable
        errorTitle="Couldn't load users"
        caption="Company users, with their role, phone and status"
        data={users}
        columns={columns}
        getRowId={(u) => u.membershipId}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        search={{
          placeholder: "Search users by name or email…",
          value: params.search ?? "",
          onChange: (v) => write((p) => withSearch(p, v)),
        }}
        server={{ meta, params, onParams }}
        toolbarActions={toolbarActions}
        minWidth="46rem"
        emptyTitle="No users yet"
        emptyDescription="Invite your first user to give them access to this company."
        emptyAction={toolbarActions}
        filteredEmptyTitle="No users match that search"
        filteredEmptyDescription="Try a different name or email."
      />

      <EditUserDialog open={editOpen} onOpenChange={setEditOpen} user={managed} />
      <DeleteUserDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        user={pendingDelete}
      />
    </>
  );
}
