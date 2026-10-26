import { useState } from "react";
import { Plus } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ErrorState } from "@/components/shared/states";
import { AddFranchiseeAdminDialog } from "@/components/franchisees/AddFranchiseeAdminDialog";
import { ReissueFranchiseeAdminPasswordDialog } from "@/components/franchisees/ReissueFranchiseeAdminPasswordDialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import {
  useActivateFranchiseeAdmin,
  useDeactivateFranchiseeAdmin,
  useFranchiseeAdmins,
} from "@/hooks/useFranchisees";
import { formatDateTime } from "@/utils/datetime";
import type { Franchisee, FranchiseeAdmin } from "@/types/franchisee";

const NONE = "—";

/**
 * The franchisee's own logins, on its detail page.
 *
 * A franchisee admin is a login (hard rule 0: this screen's rows are always THAT
 * franchisee's — the list comes from `/franchisees/{id}/admins` and the server
 * 404s a foreign id). `lastLoginAt` is "Last active", because a session refresh
 * writes it too — it is activity, not a login count.
 *
 * R3 (owner ruling 2026-10-15): the last active admin of a NON-home franchisee
 * cannot be deactivated — the row's *Deactivate* renders disabled with the
 * reason AS PLAIN TEXT under it, not behind a hover, so it reads the same on
 * touch. The server still holds the real veto (409 `FRANCHISEE_LAST_ADMIN`); a
 * stale list that lets a click through is answered by its toast.
 */
export function FranchiseeAdminsPanel({
  franchisee,
  canManage,
}: {
  franchisee: Franchisee;
  canManage: boolean;
}) {
  const { data, isLoading, isError, error, refetch } =
    useFranchiseeAdmins(franchisee.id);
  const deactivate = useDeactivateFranchiseeAdmin();
  const activate = useActivateFranchiseeAdmin();
  const [adding, setAdding] = useState(false);
  const [reissuing, setReissuing] = useState<FranchiseeAdmin | null>(null);
  const [deactivating, setDeactivating] = useState<FranchiseeAdmin | null>(null);

  return (
    <section className="rounded-lg border border-line bg-surface-1">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-3">
        <div>
          <h3 className="text-[15px] font-semibold text-ink">Franchisee admins</h3>
          <p className="text-[12px] text-ink-3">
            {franchisee.isHome
              ? "Optional for the home franchisee — your area managers and heads already run its technicians."
              : "They sign in to the franchise portal and run this franchisee's technicians and money."}
          </p>
        </div>
        {canManage ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAdding(true)}
          >
            <Plus data-icon="inline-start" />
            Add admin
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="grid gap-2 p-3.5">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      ) : isError ? (
        <div className="p-3.5">
          <ErrorState
            title="Couldn't load the admins"
            error={error}
            onRetry={() => refetch()}
          />
        </div>
      ) : data && data.length > 0 ? (
        <ul className="divide-y divide-line">
          {data.map((admin) => (
            <AdminRow
              key={admin.membershipId}
              admin={admin}
              franchisee={franchisee}
              canManage={canManage}
              busy={deactivate.isPending || activate.isPending}
              onReissue={() => setReissuing(admin)}
              onDeactivate={() => setDeactivating(admin)}
              onActivate={() =>
                activate.mutate(
                  { franchiseeId: franchisee.id, membershipId: admin.membershipId },
                  { onSuccess: (saved) => toast.add({ title: `${nameOf(saved)} activated` }) }
                )
              }
            />
          ))}
        </ul>
      ) : (
        <p className="px-3.5 py-6 text-center text-[13px] text-ink-3">
          No admins yet — add one and they get an email with a temporary
          password.
        </p>
      )}

      <AddFranchiseeAdminDialog
        open={adding}
        onOpenChange={setAdding}
        franchisee={franchisee}
      />

      <ReissueFranchiseeAdminPasswordDialog
        open={reissuing !== null}
        onOpenChange={(open) => !open && setReissuing(null)}
        franchiseeId={franchisee.id}
        franchiseeName={franchisee.name}
        admin={reissuing ?? undefined}
      />

      <ConfirmDialog
        open={deactivating !== null}
        onOpenChange={(open) => !open && setDeactivating(null)}
        title={`Deactivate ${nameOf(deactivating)}?`}
        description="They are signed out everywhere and cannot sign in until reactivated."
        confirmLabel="Deactivate admin"
        isPending={deactivate.isPending}
        onConfirm={() =>
          deactivating &&
          deactivate.mutate(
            {
              franchiseeId: franchisee.id,
              membershipId: deactivating.membershipId,
            },
            {
              onSuccess: (saved) => {
                toast.add({ title: `${nameOf(saved)} deactivated` });
                setDeactivating(null);
              },
              // A 409 FRANCHISEE_LAST_ADMIN from a stale list is reported by
              // the toaster, over the still-open dialog — it does not close
              // itself (the way every ConfirmDialog here behaves).
            }
          )
        }
      />
    </section>
  );
}

function nameOf(admin: FranchiseeAdmin | null): string {
  return admin?.fullName ?? "This admin";
}

function AdminRow({
  admin,
  franchisee,
  canManage,
  busy,
  onReissue,
  onDeactivate,
  onActivate,
}: {
  admin: FranchiseeAdmin;
  franchisee: Franchisee;
  canManage: boolean;
  busy: boolean;
  onReissue: () => void;
  onDeactivate: () => void;
  onActivate: () => void;
}) {
  const name = admin.fullName ?? "This admin";
  // The ruling is the server's, never recomputed in the browser. The home is
  // exempt — it has no parts desk to strand (R4), so its last admin is
  // deliberately deactivatable.
  const lastAdmin = admin.isActive && admin.isLastActiveAdmin && !franchisee.isHome;
  return (
    <li className="px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-[13px] font-semibold text-ink">{name}</p>
          <p className="truncate text-xs text-ink-3">{admin.email ?? NONE}</p>
        </div>
        <span className="text-[13px] text-ink-2">
          {admin.phone ?? NONE}
        </span>
        <span className="text-[13px] text-ink-2">
          {admin.lastLoginAt ? formatDateTime(admin.lastLoginAt) : "Never"}
        </span>
        <span className="text-[13px] text-ink-2">
          {admin.isActive ? "Active" : "Inactive"}
        </span>
        {canManage ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {admin.isActive ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={onReissue}
                >
                  Email a new password
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || lastAdmin}
                  onClick={onDeactivate}
                >
                  Deactivate
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={onActivate}
              >
                Activate
              </Button>
            )}
          </div>
        ) : null}
      </div>
      {lastAdmin ? (
        // Plain text, in the row — a menu-item description nobody can read on
        // touch would hide the one fact that explains a disabled button.
        <p className="mt-1.5 text-[12px] text-ink-3">
          Add another admin first — {name} is {franchisee.name}'s only active
          admin, and without one nobody can approve its technicians' UPI changes
          or pay their redemptions.
        </p>
      ) : null}
    </li>
  );
}