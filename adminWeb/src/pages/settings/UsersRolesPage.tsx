import { useState } from "react";
import { Plus } from "lucide-react";
import { PageMeta } from "@/components/shared/PageMeta";
import { InviteUserDialog } from "@/components/settings/InviteUserDialog";
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
  const [inviting, setInviting] = useState(false);

  return (
    <>
      <PageMeta
        title="Users & roles"
        description="Console access management — role, scope and status per user."
      />

      <div className="mb-3.5 flex justify-end">
        <Button onClick={() => setInviting(true)}>
          <Plus data-icon="inline-start" />
          Invite user
        </Button>
      </div>

      <InviteUserDialog open={inviting} onOpenChange={setInviting} />


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
