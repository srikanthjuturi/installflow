import { useState } from "react";
import { ArrowLeft, Pencil, Users } from "lucide-react";
import { useLocation, useParams } from "react-router";
import { FranchiseeAdminsPanel } from "@/components/franchisees/FranchiseeAdminsPanel";
import { FranchiseeBadges } from "@/components/franchisees/FranchiseeBadges";
import { FranchiseeFacts } from "@/components/franchisees/FranchiseeFacts";
import { FranchiseeFormDialog } from "@/components/franchisees/FranchiseeFormDialog";
import { PincodeRangesDialog } from "@/components/franchisees/PincodeRangesDialog";
import { LinkButton } from "@/components/shared/LinkButton";
import { PageMeta } from "@/components/shared/PageMeta";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ErrorState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { useFeatureAccess } from "@/hooks/useAuth";
import { readNavOrigin } from "@/hooks/useNavOrigin";
import {
  useActivateFranchisee,
  useDeactivateFranchisee,
  useFranchisee,
  useFranchiseeOptions,
} from "@/hooks/useFranchisees";
import type { Franchisee } from "@/types/franchisee";

/**
 * One franchisee, on a page — not in a bigger dialog. The admins section, the
 * pincode text and the technician count need a page a read-only Area Manager
 * can open; a dialog in read-only mode would be a form with every control
 * disabled (Task 08 §5.5).
 *
 * `useRecordRecentlySeen` is deliberately NOT called: the global search has no
 * franchisee kind, and adding one is out of scope (Task 08 §5.6).
 */
export default function FranchiseePage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const origin = readNavOrigin(location.state);
  const backHref = origin?.backTo ?? "/franchisees";
  const backText = origin?.backLabel ?? "Back to franchisees";

  const { data: franchisee, isLoading, isError, error, refetch } = useFranchisee(id);
  // For the deactivate copy's {homeName}. Same cached options list the list
  // page and the Technicians screen share.
  const { data: options } = useFranchiseeOptions();
  const homeName = options?.find((o) => o.isHome)?.name ?? "the home franchisee";

  const [isEditOpen, setEditOpen] = useState(false);
  const [isPincodesOpen, setPincodesOpen] = useState(false);
  const [isDeactivateOpen, setDeactivateOpen] = useState(false);
  const deactivate = useDeactivateFranchisee();
  const activate = useActivateFranchisee();

  // Presentation only — the server enforces the feature and the floor (rule 8).
  const canManage = useFeatureAccess().has("franchisees.manage");

  return (
    <>
      <PageMeta
        title={`Franchisee ${id}`}
        description="One franchisee's pincodes, admins and technicians."
      />

      {franchisee ? (
        <FranchiseeFormDialog
          open={isEditOpen}
          onOpenChange={setEditOpen}
          franchisee={franchisee}
        />
      ) : null}
      {franchisee && !franchisee.isHome ? (
        <PincodeRangesDialog
          open={isPincodesOpen}
          onOpenChange={setPincodesOpen}
          franchisee={franchisee}
          homeName={homeName}
        />
      ) : null}

      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
        <LinkButton
          variant="ghost"
          size="sm"
          className="-ml-2"
          to={backHref}
          state={origin?.backState}
        >
          <ArrowLeft data-icon="inline-start" />
          {backText}
        </LinkButton>

        {franchisee && canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditOpen(true)}
            >
              <Pencil data-icon="inline-start" />
              Edit details
            </Button>
            {/* Steps 1 and 2 are separate here as on the list: the pincodes are
                this franchisee's territory, not its identity. */}
            {!franchisee.isHome ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPincodesOpen(true)}
              >
                Edit pincodes
              </Button>
            ) : null}
            {franchisee.isActive ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-danger"
                onClick={() => setDeactivateOpen(true)}
              >
                Deactivate
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={activate.isPending}
                onClick={() =>
                  activate.mutate(franchisee.id, {
                    onSuccess: (activated) =>
                      toast.add({
                        title: `${activated.name} activated`,
                        description:
                          "Give it pincodes to start sending it tickets.",
                      }),
                  })
                }
              >
                Activate
              </Button>
            )}
          </div>
        ) : null}
      </div>

      {isError ? (
        <ErrorState
          /* A 404 also lands here — "not found on YOUR company" is the honest
             wording either way (adminWeb hard rule 0). */
          title="Couldn't load this franchisee"
          error={error}
          onRetry={() => refetch()}
        />
      ) : (
        <div className="grid gap-3.5 lg:grid-cols-2">
          {isLoading || !franchisee ? (
            <>
              <Skeleton className="h-100 rounded-xl" />
              <Skeleton className="h-100 rounded-xl" />
            </>
          ) : (
            <>
              <section className="rounded-lg border border-line bg-surface-1">
                <Header franchisee={franchisee} />
              </section>

              {/* The seven facts, answered even where the answer is "—". */}
              <FranchiseeFacts franchisee={franchisee} />

              <section className="rounded-lg border border-line bg-surface-1">
                <h3 className="border-b border-line px-3.5 py-3 text-[15px] font-semibold text-ink">
                  Pincodes
                </h3>
                <div className="px-3.5 py-3">
                  <p className="text-[13px] text-ink-2">
                    {franchisee.isHome
                      ? "All unclaimed"
                      : franchisee.pincodeRanges
                        ? `${franchisee.pincodeCount.toLocaleString()} pincodes`
                        : "No pincodes yet — this franchisee owns nothing and is offered no tickets."}
                  </p>
                  {franchisee.pincodeRanges ? (
                    <p className="mt-2 font-mono text-[12.5px] break-all text-ink-2">
                      {franchisee.pincodeRanges}
                    </p>
                  ) : null}
                </div>
              </section>

              <section className="rounded-lg border border-line bg-surface-1">
                <h3 className="border-b border-line px-3.5 py-3 text-[15px] font-semibold text-ink">
                  Technicians
                </h3>
                <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-3">
                  {/* Live COUNTs the API sends — never derived or cached. */}
                  <p className="text-[13px] text-ink-2">
                    {franchisee.technicianCount.toLocaleString()} technicians
                    {" · "}
                    {franchisee.openInviteCount.toLocaleString()} open invites
                  </p>
                  {/* Lands filtered: the list seeds franchiseeId from the URL. */}
                  <LinkButton
                    type="button"
                    variant="outline"
                    size="sm"
                    to={`/technicians?franchiseeId=${franchisee.id}`}
                    state={origin}
                  >
                    <Users data-icon="inline-start" />
                    View technicians
                  </LinkButton>
                </div>
              </section>

              <FranchiseeAdminsPanel franchisee={franchisee} canManage={canManage} />

              {/* Task 13's HomeFacilityUsersCard goes on the home franchisee's
                  page only (owner ruling 2026-10-15, R4; Task 08 §5.6). The home
                  has no parts desk until somebody adds a facility user, and that
                  work owns its own card — explicitly OUT OF SCOPE here, not a
                  TODO this screen forgot (Task 08 §8, item 10). */}
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        open={isDeactivateOpen}
        onOpenChange={setDeactivateOpen}
        title={`Deactivate ${franchisee?.name ?? "franchisee"}?`}
        description={
          franchisee
            ? `Its ${franchisee.pincodeCount.toLocaleString()} pincodes go back to ${homeName}, with any open tickets nobody has taken. Its admins can no longer sign in. This is refused while it still has technicians.`
            : undefined
        }
        confirmLabel="Deactivate"
        isPending={deactivate.isPending}
        onConfirm={() =>
          franchisee &&
          deactivate.mutate(franchisee.id, {
            onSuccess: (deactivated) => {
              toast.add({ title: `${deactivated.name} deactivated` });
              setDeactivateOpen(false);
            },
            // A 409 FRANCHISEE_HAS_TECHNICIANS is reported by the toaster over
            // the still-open dialog — ConfirmDialog never closes itself.
          })
        }
      />
    </>
  );
}

/** The monogram, the name, the kind/home badges — the page's own header card. */
function Header({ franchisee: franchisee }: { franchisee: Franchisee }) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-3.5 py-3">
      <div
        aria-hidden
        className="grid size-10 place-items-center rounded-md bg-surface-3 text-sm font-semibold text-ink-2"
      >
        {franchisee.name.slice(0, 2).toUpperCase()}
      </div>
      <div>
        <h3 className="text-[15px] font-semibold text-ink">{franchisee.name}</h3>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="font-mono text-xs text-ink-3">{franchisee.code}</span>
          <FranchiseeBadges kind={franchisee.kind} isHome={franchisee.isHome} />
        </div>
      </div>
    </div>
  );
}