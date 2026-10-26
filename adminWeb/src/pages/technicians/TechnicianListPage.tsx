import { useState } from "react";
import { Plus, Send } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { PageMeta } from "@/components/shared/PageMeta";
import { DeleteTechnicianDialog } from "@/components/technicians/DeleteTechnicianDialog";
import { TechnicianFormDialog } from "@/components/technicians/TechnicianFormDialog";
import { TechnicianInviteDialog } from "@/components/technicians/TechnicianInviteDialog";
import { TYPE_WORD_TO_WIRE } from "@/components/technicians/technicianType";
import { TechTable } from "@/components/technicians/TechTable";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useFeatureAccess } from "@/hooks/useAuth";
import { useFranchiseeOptions } from "@/hooks/useFranchisees";
import {
  useCancelInvite,
  useInviteTechnician,
  useResendInvite,
  useSendAppLink,
  useTechnicianFilterOptions,
  useTechnicians,
} from "@/hooks/useTechnicians";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useUrlSeededListParams } from "@/hooks/useListParams";
import type { Technician, TechnicianRow } from "@/types/technician";
import { copyToClipboard } from "@/utils/clipboard";
import { formatPhone, toE164 } from "@/utils/phone";

export default function TechnicianListPage() {
  /* One dialog for both verbs. `editing` is what it is pointed at: undefined is
     the Add form, a technician is that technician's record. */
  const [isFormOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Technician | undefined>(undefined);
  const [isInviteOpen, setInviteOpen] = useState(false);
  const [cancelling, setCancelling] = useState<TechnicianRow | null>(null);
  const [deleting, setDeleting] = useState<Technician | undefined>(undefined);

  const invite = useInviteTechnician();
  const resend = useResendInvite();
  const cancel = useCancelInvite();
  const sendAppLink = useSendAppLink();

  const { has } = useFeatureAccess();
  // Task 09 — the buttons gate on the WORKSPACE's keys: `technicians.*` in the
  // staff console, the single `franchise.technicians` in the portal (§5.2),
  // so a reused page hands `has` the key its adapter names.
  const { workspace, features } = useWorkspace();
  const canCreate = has(features.createTechnician);
  const canInvite = has(features.inviteTechnician);
  const canEdit = has(features.editTechnician);
  // The Region/District filter sources per workspace — ops reads the staff
  // territory tables, the portal reads its options endpoint and offers no
  // districts (§5.4).
  const { regions, districts } = useTechnicianFilterOptions();

  // The Franchisee filter's options. Only for a caller who can see the
  // franchisees screen at all — otherwise the request would 403 and toast, and
  // the filter it feeds is not coming anyway. Task 09 — ops-only twice over:
  // the portal's rows all name the same franchisee, so its column and filter
  // are not drawn and no `/franchisees` read is made.
  const { data: franchiseeOptions } = useFranchiseeOptions({
    enabled: workspace === "ops" && has("franchisees.view"),
  });

  // The query the server answers. Search, filters and page all live in one
  // object so the table can hand back a whole new intent in one call. The
  // table already strips "All" — it is a control value, not a filter — so
  // nothing here has to know which values are sentinels.
  // Seeded from the URL so the territory panel's "8 technicians in
  // Visakhapatnam" lands here already filtered to that district — and, since
  // Task 08, so a franchisee page's "View technicians" lands filtered to that
  // franchisee (`?franchiseeId=…`).
  const [params, setParams] = useUrlSeededListParams(
    {},
    ["districtId", "franchiseeId", "technicianType"]
  );

  const { data, isLoading, isError, error, refetch } = useTechnicians(params);

  const busyInviteId =
    resend.isPending || cancel.isPending
      ? ((resend.variables ?? cancel.variables) as string | undefined) ?? null
      : null;

  return (
    <>
      <PageMeta
        title="Technicians"
        description="Technician master list — categories, pincodes, region, bandwidth, availability and how each was onboarded."
      />

      <TechnicianFormDialog
        open={isFormOpen}
        onOpenChange={setFormOpen}
        technician={editing}
      />

      <DeleteTechnicianDialog
        open={deleting !== undefined}
        onOpenChange={(open) => !open && setDeleting(undefined)}
        technician={deleting}
      />

      <TechnicianInviteDialog
        open={isInviteOpen}
        onOpenChange={setInviteOpen}
        isSubmitting={invite.isPending}
        onSubmit={(values) =>
          invite.mutate(
            {
              phone: toE164(values.phone),
              regionId: values.regionId || null,
              pincodes: values.pincodes,
              technicianType: TYPE_WORD_TO_WIRE[values.technicianType],
            },
            {
              onSuccess: (created) => {
                /* A refused send is not an error: the invite exists and can be
                   resent, and the link is on the row to send by hand. */
                toast.add({
                  title:
                    created.status === "sent"
                      ? `Invite sent to ${formatPhone(created.phone)}`
                      : "Invite saved, but not delivered",
                  description:
                    created.status === "sent"
                      ? undefined
                      : (created.failureReason ??
                        "Copy the link from the row and send it another way."),
                });
                setInviteOpen(false);
              },
            }
          )
        }
      />

      <TechTable
        rows={data?.rows}
        meta={data?.pagination}
        params={params}
        onParams={setParams}
        regions={regions}
        districts={districts}
        franchisees={workspace === "ops" ? (franchiseeOptions ?? []) : []}
        isLoading={isLoading}
        error={isError ? error : null}
        onRetry={() => refetch()}
        canManageInvites={canInvite}
        canEditTechnician={canEdit}
        onEditTechnician={(technician) => {
          setEditing(technician);
          setFormOpen(true);
        }}
        canSendAppLink={canCreate}
        onDeleteTechnician={(technician) => setDeleting(technician)}
        busyTechnicianId={sendAppLink.isPending ? sendAppLink.variables : null}
        onSendAppLink={(technician) =>
          sendAppLink.mutate(technician.id, {
            /* Like Resend on an invite: a refusal is an answer, not an error,
               and the link comes back to hand over another way. */
            onSuccess: (outcome) =>
              toast.add({
                title:
                  outcome.appLinkStatus === "sent"
                    ? `App link sent to ${formatPhone(technician.phone)}`
                    : `Couldn't reach ${formatPhone(technician.phone)}`,
                description:
                  outcome.appLinkStatus === "sent"
                    ? undefined
                    : `${outcome.appLinkError ?? "WhatsApp did not take it."} Send them ${outcome.appLink} another way.`,
              }),
          })
        }
        busyInviteId={busyInviteId}
        onResend={(row: TechnicianRow) =>
          resend.mutate(row.id, {
            onSuccess: (updated) =>
              toast.add({
                title:
                  updated.status === "sent"
                    ? `Invite resent to ${formatPhone(updated.phone)}`
                    : `Still couldn't reach ${formatPhone(updated.phone)}`,
                description:
                  updated.status === "sent"
                    ? undefined
                    : (updated.failureReason ?? undefined),
              }),
          })
        }
        /* Cancelling an invite is a DELETE, so it asks first — the row sits
           beside Resend and Copy link, both harmless. */
        onCancel={(row: TechnicianRow) => setCancelling(row)}
        onCopyLink={(row: TechnicianRow) => {
          if (row.registered) return;
          void copyToClipboard(row.inviteLink).then((copied) =>
            toast.add({
              title: copied
                ? `Invite link copied for ${formatPhone(row.phone)}`
                : "Couldn't copy the link",
              // Shown either way: when the copy failed it is the only way to
              // get the link, and when it worked it confirms what was copied.
              description: row.inviteLink,
            })
          );
        }}
        toolbarActions={
          <div className="flex flex-wrap gap-2">
            {canInvite ? (
              <Button
                variant="outline"
                size="toolbar"
                onClick={() => setInviteOpen(true)}
              >
                <Send data-icon="inline-start" />
                Invite technician
              </Button>
            ) : null}
            {canCreate ? (
              <Button
                size="toolbar"
                onClick={() => {
                  // Clear whatever the last Edit pointed the dialog at, or
                  // "Add technician" would reopen that technician's record.
                  setEditing(undefined);
                  setFormOpen(true);
                }}
              >
                <Plus data-icon="inline-start" />
                Add technician
              </Button>
            ) : null}
          </div>
        }
      />

      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(open) => !open && setCancelling(null)}
        title={
          cancelling
            ? `Cancel the invite to ${formatPhone(cancelling.phone)}?`
            : "Cancel this invite?"
        }
        description="The link stops working. You can invite this number again afterwards."
        confirmLabel="Cancel invite"
        cancelLabel="Keep it"
        isPending={cancel.isPending}
        onConfirm={() => {
          if (!cancelling) return;
          const row = cancelling;
          cancel.mutate(row.id, {
            onSuccess: () => {
              toast.add({
                title: `Invite to ${formatPhone(row.phone)} cancelled`,
              });
              setCancelling(null);
            },
          });
        }}
      />
    </>
  );
}
