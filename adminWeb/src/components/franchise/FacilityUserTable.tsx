import { MoreHorizontal, Plus, UserCog } from "lucide-react";
import {
  DataTable,
  type Column,
} from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useParamsWriter, withSearch } from "@/hooks/useListParams";
import { cn } from "@/lib/utils";
import type { ListParams, PaginationMeta } from "@/types/api";
import type { FacilityUser } from "@/types/parts";
import { formatPhone } from "@/utils/phone";
import { ROLE_WIRE_TO_WORD } from "./facilityRoles";

const NONE = "—";

/** Static strings — an interpolated `text-${status}` is never generated. */
const STATUS_CLASS: Record<"Active" | "Deactivated", string> = {
  Active: "text-ok",
  Deactivated: "text-ink-3",
};

/**
 * A franchisee's facility users, in server mode — Task 13 §5.7.
 *
 * Mirrors `VendorUsersPage`'s table. Presentational: the owner (`FacilityUsersSection`)
 * holds the query and the dialogs, so the same table serves the portal's page and
 * the home card on the Franchisees page.
 *
 * `canManage(user)` decides whether a row has a menu — never your own row, and a
 * facility admin only on operators — and is presentation only (hard rule 8); the
 * server answers 403 regardless. *Activate* fires straight through and
 * *Deactivate* asks (only the destructive direction does).
 */
export function FacilityUserTable({
  users,
  meta,
  params,
  onParams,
  isLoading,
  isFetching,
  error,
  onRetry,
  canManage,
  canAdd,
  onAdd,
  onReissue,
  onDeactivate,
  onActivate,
  emptyTitle = "No facility users yet",
  emptyDescription = "Add the people who run your parts store. They sign in here and see only spare-part requests.",
  bare = false,
}: {
  users?: FacilityUser[];
  meta?: PaginationMeta;
  params: ListParams;
  onParams: (next: ListParams) => void;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  canManage: (user: FacilityUser) => boolean;
  canAdd: boolean;
  onAdd: () => void;
  onReissue: (user: FacilityUser) => void;
  onDeactivate: (user: FacilityUser) => void;
  onActivate: (user: FacilityUser) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Inside a Card already (the home card) — no second rounded surface. */
  bare?: boolean;
}) {
  const write = useParamsWriter(params, onParams);

  const columns: Column<FacilityUser>[] = [
    {
      id: "name",
      header: "Name",
      cell: (u) => (
        <div className="leading-tight">
          <p className="text-[13px] font-semibold">{u.fullName ?? NONE}</p>
          <p className="text-xs text-ink-3">{u.email ?? NONE}</p>
        </div>
      ),
    },
    {
      id: "phone",
      header: "Phone",
      cell: (u) => (u.phone ? formatPhone(u.phone) : NONE),
    },
    {
      id: "role",
      header: "Role",
      cell: (u) => ROLE_WIRE_TO_WORD[u.role] ?? u.role,
    },
    {
      id: "status",
      header: "Status",
      cell: (u) => {
        const word = u.isActive ? "Active" : "Deactivated";
        return <span className={cn("text-[13px]", STATUS_CLASS[word])}>{word}</span>;
      },
    },
    {
      id: "actions",
      header: "Actions",
      hideHeader: true,
      align: "right",
      cell: (u) => {
        // No menu on your own row, and none where the viewer's rank does not
        // reach — an empty menu is worse than none.
        if (!canManage(u)) return <span className="text-ink-3">{NONE}</span>;
        const name = u.fullName ?? "this user";
        return (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Actions for ${name}`}
                />
              }
            >
              <MoreHorizontal aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-auto min-w-48 max-w-[calc(100vw-2rem)]"
            >
              <DropdownMenuItem onClick={() => onReissue(u)}>
                Email a new password
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {u.isActive ? (
                <DropdownMenuItem
                  className="text-danger"
                  onClick={() => onDeactivate(u)}
                >
                  Deactivate
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => onActivate(u)}>
                  Activate
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <DataTable
      bare={bare}
      errorTitle="Couldn't load facility users"
      caption="Facility users who approve and log spare parts, with their role and whether they can sign in"
      data={users}
      columns={columns}
      getRowId={(u) => u.membershipId}
      isLoading={isLoading}
      isFetching={isFetching}
      error={error}
      onRetry={onRetry}
      search={{
        placeholder: "Search name or email",
        value: params.search ?? "",
        onChange: (v) => write((p) => withSearch(p, v)),
      }}
      server={{ meta, params, onParams }}
      minWidth="44rem"
      toolbarActions={
        canAdd ? (
          <Button type="button" size="toolbar" onClick={onAdd}>
            <Plus data-icon="inline-start" aria-hidden />
            Add facility user
          </Button>
        ) : undefined
      }
      emptyIcon={UserCog}
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
      filteredEmptyTitle="No users match that search"
      filteredEmptyDescription="Try a different name or email."
    />
  );
}
