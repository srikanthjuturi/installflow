import { useState } from "react";
import { Plus } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { PageMeta } from "@/components/shared/PageMeta";
import { DataTable } from "@/components/shared/DataTable";
import type { Column } from "@/components/shared/DataTable/types";
import { AddVendorUserDialog } from "@/components/vendor/AddVendorUserDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useListParams } from "@/hooks/useListParams";
import { useMe } from "@/hooks/useAuth";
import { useDeleteVendorUser, useVendorUsers } from "@/hooks/useVendorUsers";
import type { VendorUser } from "@/types/vendorUser";

const NONE = "—";

/**
 * The vendor's own people.
 *
 * Deliberately NOT `UsersTable`. That table computes who may be managed from
 * `GET /roles`, which a vendor cannot call — the request 403s, the rank
 * comparison falls through to `-Infinity <= -Infinity`, and every row silently
 * loses its actions. It also carries a role and a territory column that are
 * blank for every row here.
 */
export default function VendorUsersPage() {
  const [params, setParams] = useListParams();
  const { data, isLoading, isError, error, refetch } = useVendorUsers(params);
  const { data: me } = useMe();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<VendorUser | null>(null);
  const remove = useDeleteVendorUser();

  const columns: Column<VendorUser>[] = [
    {
      id: "user",
      header: "User",
      cell: (u) => (
        <div className="leading-tight">
          <p className="text-[13px] font-semibold">{u.fullName ?? NONE}</p>
          <p className="text-xs text-ink-3">{u.email ?? NONE}</p>
        </div>
      ),
    },
    {
      id: "kind",
      header: "Account",
      cell: (u) =>
        u.isOwner ? (
          <Badge variant="outline">Vendor login</Badge>
        ) : (
          <span className="text-[13px] text-ink-2">User</span>
        ),
    },
    { id: "phone", header: "Phone", cell: (u) => u.phone ?? NONE },
    {
      id: "status",
      header: "Status",
      cell: (u) => (u.isActive ? "Active" : "Suspended"),
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (u) =>
        // The vendor's own login is created with the vendor and reissued from
        // the Vendors screen; a second place to change it is a second place for
        // the two to disagree. The server refuses it either way.
        u.isOwner || u.userId === me?.user.id ? (
          <span className="text-ink-3">{NONE}</span>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRemoving(u)}
          >
            Remove
          </Button>
        ),
    },
  ];

  return (
    <>
      <PageMeta
        title="Users"
        description="People who can raise tickets for you."
      />

      <h2 className="mb-4 text-lg font-semibold">Users</h2>

      <DataTable
        caption="Users who can raise tickets for this vendor"
        columns={columns}
        data={data?.rows}
        getRowId={(u) => u.membershipId}
        server={{ meta: data?.pagination, params, onParams: setParams }}
        isLoading={isLoading}
        error={isError ? error : null}
        onRetry={() => refetch()}
        search={{ placeholder: "Search name or email" }}
        emptyTitle="No users yet"
        emptyDescription="Add someone and they can raise tickets for you."
        filteredEmptyTitle="No users match that search"
        filteredEmptyDescription="Try a different name or email."
        errorTitle="Couldn't load your users"
        toolbarActions={
          <Button type="button" size="toolbar" onClick={() => setAdding(true)}>
            <Plus data-icon="inline-start" />
            Add user
          </Button>
        }
      />

      <AddVendorUserDialog open={adding} onOpenChange={setAdding} />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.fullName ?? "user"}?`}
        description="They lose access immediately and are signed out. The tickets they raised keep their name."
        confirmLabel="Remove user"
        isPending={remove.isPending}
        onConfirm={() =>
          removing &&
          remove.mutate(removing.membershipId, {
            onSuccess: () => {
              toast.add({ title: `${removing.fullName ?? "User"} removed` });
              setRemoving(null);
            },
          })
        }
      />
    </>
  );
}
