import { Plus } from "lucide-react";
import { PageMeta } from "@/components/shared/PageMeta";
import { UserTable } from "@/components/settings/UserTable";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useUsers } from "@/hooks/useSettings";

/**
 * Who can sign in to the console, and the scope each of them works inside:
 * NH across every region, RSH one region, ASM a pincode range, Ops Staff
 * intake only. The customer and the technician never appear here.
 *
 * Presentation only — RBAC is enforced server-side, so nothing on this screen
 * grants or revokes anything.
 */
export default function UsersRolesPage() {
  const { data, isLoading, isError, error, refetch } = useUsers();

  return (
    <>
      <PageMeta
        title="Users & roles"
        description="Console access management — role, scope and status per user."
      />

      <div className="mb-3.5 flex justify-end">
        {/* No invite form is designed yet, and provisioning is a server-side
            concern — so the action is present and deliberately inert rather
            than invented. */}
        <Button disabled>
          <Plus data-icon="inline-start" />
          Invite user
        </Button>
      </div>

      <Card>
        <CardContent className="px-0">
          <UserTable
            users={data}
            isLoading={isLoading}
            error={isError ? error : null}
            onRetry={() => refetch()}
          />
        </CardContent>
      </Card>
    </>
  );
}
