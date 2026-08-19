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
import {
  useCancelInvite,
  useCreateTechnician,
  useInviteTechnician,
  useResendInvite,
  useTechnicians,
} from "@/hooks/useTechnicians";
import { useListParams } from "@/hooks/useListParams";
import type { TechnicianRow } from "@/types/technician";
import { copyToClipboard } from "@/utils/clipboard";
import { formatPhone, toE164 } from "@/utils/phone";

export default function TechnicianListPage() {
  const [isFormOpen, setFormOpen] = useState(false);
  const [isInviteOpen, setInviteOpen] = useState(false);

  const create = useCreateTechnician();
  const invite = useInviteTechnician();
  const resend = useResendInvite();
  const cancel = useCancelInvite();

  const { has } = useFeatureAccess();
  const canCreate = has("technicians.create");
  const canInvite = has("technicians.invite");
  const { regions } = useAssignableRegions();

  // The query the server answers. Search, filters and page all live in one
  // object so the table can hand back a whole new intent in one call. The
  // table already strips "All" — it is a control value, not a filter — so
  // nothing here has to know which values are sentinels.
  const [params, setParams] = useListParams();

  const { data, isLoading, isError, error, refetch } = useTechnicians(params);

  const busyInviteId =
    resend.isPending || cancel.isPending
      ? ((resend.variables ?? cancel.variables) as string | undefined) ?? null
      : null;

  return (
    <>
      <PageMeta
        title="Technicians"
        description="Technician master list — categories, pincodes, region, bandwidth and how each was onboarded."
      />

      <TechnicianFormDialog
        open={isFormOpen}
        onOpenChange={setFormOpen}
        isSubmitting={create.isPending}
        onSubmit={(values) =>
          create.mutate(
            {
              fullName: values.name,
              phone: toE164(values.phone),
              regionId: values.regionId,
              subcategoryIds: values.subcategoryIds,
              pincodes: values.pincodes,
              // Omitted rather than sent as 0 when the manager did not pick
              // one: the server's default is the answer, and 0 is outside the
              // 1–12 the API accepts.
              ...(values.bwTotal
                ? { dailyJobCap: Number(values.bwTotal) }
                : {}),
              profileImageUrl: values.photo ?? null,
            },
            {
              onSuccess: (technician) => {
                toast.add({
                  title: `${technician.name} added`,
                  description: `${technician.code} · ${technician.dailyJobCap} jobs/day.`,
                });
                setFormOpen(false);
              },
            }
          )
        }
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
        isLoading={isLoading}
        error={isError ? error : null}
        onRetry={() => refetch()}
        canEdit={canInvite}
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
                className="h-10"
                onClick={() => setInviteOpen(true)}
              >
                <Send data-icon="inline-start" />
                Invite technician
              </Button>
            ) : null}
            {canCreate ? (
              <Button className="h-10" onClick={() => setFormOpen(true)}>
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
