import { useState } from "react";
import { Plus, Send } from "lucide-react";
import { PageMeta } from "@/components/shared/PageMeta";
import { TechnicianFormDialog } from "@/components/technicians/TechnicianFormDialog";
import { TechnicianInviteDialog } from "@/components/technicians/TechnicianInviteDialog";
import { TechTable } from "@/components/technicians/TechTable";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useFeatureAccess } from "@/hooks/useAuth";
import { useAssignableRegions } from "@/hooks/useCompanyUsers";
import { useDistricts } from "@/hooks/useGeo";
import {
  useCancelInvite,
  useInviteTechnician,
  useResendInvite,
  useTechnicians,
} from "@/hooks/useTechnicians";
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

  const invite = useInviteTechnician();
  const resend = useResendInvite();
  const cancel = useCancelInvite();

  const { has } = useFeatureAccess();
  const canCreate = has("technicians.create");
  const canInvite = has("technicians.invite");
  const canEdit = has("technicians.edit");
  const { regions } = useAssignableRegions();
  // Scoped by the server to the caller's own territory, so the dropdown can
  // never offer a district whose technicians they would not be shown.
  const { data: districts } = useDistricts({ mine: true });

  // The query the server answers. Search, filters and page all live in one
  // object so the table can hand back a whole new intent in one call. The
  // table already strips "All" — it is a control value, not a filter — so
  // nothing here has to know which values are sentinels.
  // Seeded from the URL so the territory panel's "8 technicians in
  // Visakhapatnam" lands here already filtered to that district.
  const [params, setParams] = useUrlSeededListParams({}, ["districtId"]);

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
        districts={districts ?? []}
        isLoading={isLoading}
        error={isError ? error : null}
        onRetry={() => refetch()}
        canManageInvites={canInvite}
        canEditTechnician={canEdit}
        onEditTechnician={(technician) => {
          setEditing(technician);
          setFormOpen(true);
        }}
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
        onCancel={(row: TechnicianRow) =>
          cancel.mutate(row.id, {
            onSuccess: () =>
              toast.add({
                title: `Invite to ${formatPhone(row.phone)} cancelled`,
              }),
          })
        }
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
    </>
  );
}
