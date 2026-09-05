import { useState } from "react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { UserAvatar } from "@/components/shared/UserAvatar";
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
import { ReissuePasswordDialog } from "./ReissuePasswordDialog";

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
  const [reissueFor, setReissueFor] = useState<CompanyUser | undefined>(
    undefined
  );
  const [reissueOpen, setReissueOpen] = useState(false);
  // Only the SUSPEND direction confirms. Activating is constructive.
  const [suspending, setSuspending] = useState<CompanyUser | null>(null);

  const write = useParamsWriter(params, onParams);
  const update = useUpdateUser();
  const myRank = useMyRank();
  const { data: roles } = useRoles();
  const rankOf = (roleKey: string) =>
    roles?.find((r) => r.key === roleKey)?.rank ?? -Infinity;

  /**
   * `onDone` runs on SUCCESS only, so a failed suspend leaves the confirmation
   * standing over the toast rather than dismissing as though it had worked.
   */
  function toggleStatus(u: CompanyUser, onDone?: () => void) {
    update.mutate(
      { id: u.membershipId, input: { isActive: !u.isActive } },
      {
        onSuccess: (saved) => {
          toast.add({
            title: `${saved.fullName ?? saved.email} ${saved.isActive ? "activated" : "suspended"}`,
          });
          onDone?.();
        },
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
          {/* The same disc the rail and the account card draw, so the photo
              somebody uploads on Account shows up on the screen where their
              colleagues actually look them up. Falls back to initials, which
              is the permanent state for an admin — `ROLES_WITHOUT_PROFILE_IMAGE`
              means that role carries no picture to show. */}
          <UserAvatar
            name={u.fullName?.trim() || u.email}
            src={u.profileImageUrl}
            className="size-8 bg-brand-100 text-[11px] text-brand-500"
          />
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
              onClick={() =>
                u.isActive ? setSuspending(u) : toggleStatus(u)
              }
            >
              {u.isActive ? "Suspend" : "Activate"}
              <span className="sr-only"> {u.fullName ?? u.email}</span>
            </Button>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs font-semibold text-ink-2"
              onClick={() => {
                setReissueFor(u);
                setReissueOpen(true);
              }}
            >
              Reset password
              <span className="sr-only"> for {u.fullName ?? u.email}</span>
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
      <ReissuePasswordDialog
        open={reissueOpen}
        onOpenChange={setReissueOpen}
        user={reissueFor}
      />
      <DeleteUserDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        user={pendingDelete}
      />
      <ConfirmDialog
        open={suspending !== null}
        onOpenChange={(open) => !open && setSuspending(null)}
        title={`Suspend ${suspending?.fullName ?? suspending?.email ?? "user"}?`}
        description="They can't sign in to this company until you activate them again. Their role and access are kept."
        confirmLabel="Suspend user"
        isPending={update.isPending}
        onConfirm={() =>
          suspending && toggleStatus(suspending, () => setSuspending(null))
        }
      />
    </>
  );
}
