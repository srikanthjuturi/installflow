import { useState } from "react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/components/ui/toast";
import { useMe } from "@/hooks/useAuth";
import {
  useFacilityUsers,
  useSetFacilityUserActive,
} from "@/hooks/useFacilityUsers";
import { useListParams } from "@/hooks/useListParams";
import type { FacilityUserSource } from "@/services/facilityUsers";
import type { FacilityUser } from "@/types/parts";
import { AddFacilityUserDialog } from "./AddFacilityUserDialog";
import { FacilityUserTable } from "./FacilityUserTable";
import { ReissueFacilityUserPasswordDialog } from "./ReissueFacilityUserPasswordDialog";
import { canManageFacilityUser, rolesViewerCanAdd } from "./facilityRoles";

/**
 * The whole facility-users surface over one `FacilityUserSource` — Task 13 §5.7.
 *
 * Owns the list query, the add / reissue / deactivate dialogs and the activate
 * call, so the portal's `FacilityUsersPage` and the home card on the Franchisees
 * page (`HomeFacilityUsersCard`) are thin and cannot drift apart. Neither knows
 * which door `source` is; the viewer's role decides who is offered what.
 *
 * `describe` lets the card word its header by whether anyone exists (§5.10)
 * without a second request: it is handed the total of the very query the table
 * reads.
 */
export function FacilityUsersSection({
  source,
  bare = false,
  emptyTitle,
  emptyDescription,
  describe,
}: {
  source: FacilityUserSource;
  bare?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Rendered above the table with the TOTAL (undefined while loading). */
  describe?: (total: number | undefined) => React.ReactNode;
}) {
  const { data: me } = useMe();
  const viewerRole = me?.user.role;
  const selfId = me?.user.id;
  const roles = rolesViewerCanAdd(viewerRole);

  const [params, setParams] = useListParams();
  const { data, isLoading, isFetching, isError, error, refetch } =
    useFacilityUsers(source, params);
  const setActive = useSetFacilityUserActive(source);

  const [adding, setAdding] = useState(false);
  const [reissuing, setReissuing] = useState<FacilityUser | null>(null);
  const [deactivating, setDeactivating] = useState<FacilityUser | null>(null);

  // The unfiltered total: while a search is active the pagination total is the
  // match count, which must never read as "this franchisee has no parts store".
  const total = params.search ? undefined : data?.pagination.totalRecords;

  return (
    <>
      {describe ? describe(total) : null}

      <FacilityUserTable
        bare={bare}
        users={data?.rows}
        meta={data?.pagination}
        params={params}
        onParams={setParams}
        isLoading={isLoading}
        isFetching={isFetching && !isLoading}
        error={isError ? error : null}
        onRetry={() => refetch()}
        canManage={(u) =>
          canManageFacilityUser(viewerRole, u.role, u.userId === selfId)
        }
        canAdd={roles.length > 0}
        onAdd={() => setAdding(true)}
        onReissue={setReissuing}
        onDeactivate={setDeactivating}
        onActivate={(u) =>
          // Only the destructive direction asks: activating fires straight through.
          setActive.mutate(
            { membershipId: u.membershipId, isActive: true },
            {
              onSuccess: (saved) =>
                toast.add({ title: `${saved.fullName ?? "User"} activated` }),
            }
          )
        }
        emptyTitle={emptyTitle}
        emptyDescription={emptyDescription}
      />

      <AddFacilityUserDialog
        open={adding}
        onOpenChange={setAdding}
        source={source}
        roles={roles}
      />

      <ReissueFacilityUserPasswordDialog
        open={reissuing !== null}
        onOpenChange={(open) => !open && setReissuing(null)}
        source={source}
        user={reissuing ?? undefined}
      />

      <ConfirmDialog
        open={deactivating !== null}
        onOpenChange={(open) => !open && setDeactivating(null)}
        title={`Deactivate ${deactivating?.fullName ?? "this user"}?`}
        description="They can no longer sign in. Their past approvals stay on record. You can activate them again."
        confirmLabel="Deactivate"
        isPending={setActive.isPending}
        onConfirm={() =>
          deactivating &&
          setActive.mutate(
            { membershipId: deactivating.membershipId, isActive: false },
            {
              onSuccess: (saved) => {
                toast.add({ title: `${saved.fullName ?? "User"} deactivated` });
                setDeactivating(null);
              },
            }
          )
        }
      />
    </>
  );
}
