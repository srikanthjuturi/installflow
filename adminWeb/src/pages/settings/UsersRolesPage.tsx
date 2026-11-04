import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Plus } from "lucide-react";
import { PageMeta } from "@/components/shared/PageMeta";
import { AddUserDialog } from "@/components/settings/AddUserDialog";
import { UsersTable } from "@/components/settings/UsersTable";
import { Button } from "@/components/ui/button";
import { useCompanyUsers } from "@/hooks/useCompanyUsers";
import { useUrlSeededListParams } from "@/hooks/useListParams";
import { AREA_MANAGER } from "@/components/settings/companyUserSchema";

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

  // Arriving from Territory's "Assign an Area Manager": open the invite form
  // pre-selecting Area Manager and the uncovered state. Both read once from
  // the initial render (not an effect, to avoid a cascading setState-in-effect);
  // the params are then cleared so a refresh does not reopen it.
  const [search, setSearch] = useSearchParams();
  const [inviting, setInviting] = useState(() => search.get("invite") === "am");
  const [inviteInitial, setInviteInitial] = useState<
    { role: string; stateIds: string[] } | undefined
  >(() => {
    if (search.get("invite") !== "am") return undefined;
    const stateId = search.get("state");
    return { role: AREA_MANAGER, stateIds: stateId ? [stateId] : [] };
  });
  useEffect(() => {
    if (search.get("invite") === "am") {
      const next = new URLSearchParams(search);
      next.delete("invite");
      next.delete("state");
      setSearch(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <PageMeta
        title="Users & roles"
        description="Company access management — role and status per user."
      />

      <AddUserDialog
        open={inviting}
        onOpenChange={(v) => {
          setInviting(v);
          if (!v) setInviteInitial(undefined);
        }}
        initial={inviteInitial}
      />

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
