import { useState } from "react";
import { Plus } from "lucide-react";
import { PageMeta } from "@/components/shared/PageMeta";
import { AddUserDialog } from "@/components/settings/AddUserDialog";
import { UsersTable } from "@/components/settings/UsersTable";
import { Button } from "@/components/ui/button";
import { useCompanyUsers } from "@/hooks/useCompanyUsers";
import { useUrlSeededListParams } from "@/hooks/useListParams";

/**
 * Company users — who can sign in to this company and as what role. Backed by
 * the live `/users` API and scoped to the caller's company. Role assignment and
 * row actions are limited to roles below the signed-in user's own; the backend
 * enforces the same rule.
 */
export default function UsersRolesPage() {
  // Seeded from `?search=` — global search lands here, since a user has no
  // detail route of their own.
  const [params, setParams] = useUrlSeededListParams();
  const { data, isLoading, isError, error, refetch } = useCompanyUsers(params);
  const [inviting, setInviting] = useState(false);

  return (
    <>
      <PageMeta
        title="Users & roles"
        description="Company access management — role and status per user."
      />

      <AddUserDialog open={inviting} onOpenChange={setInviting} />

      <UsersTable
        users={data?.rows}
        meta={data?.pagination}
        params={params}
        onParams={setParams}
        isLoading={isLoading}
        error={isError ? error : null}
        onRetry={() => refetch()}
        toolbarActions={
          <Button size="toolbar" onClick={() => setInviting(true)}>
            <Plus data-icon="inline-start" />
            Invite user
          </Button>
        }
      />
    </>
  );
}
