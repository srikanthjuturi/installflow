import { useState } from "react";
import { Plus } from "lucide-react";
import { PageMeta } from "@/components/shared/PageMeta";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  useCancelInvite,
  useCreateInvite,
  usePartnerInvites,
  useResendInvite,
} from "@/hooks/usePartners";
import { useAssignableRegions } from "@/hooks/useCompanyUsers";
import { useListParams } from "@/hooks/useListParams";
import { toE164 } from "@/utils/phone";
import { PARTNER_TYPE_OF, type PartnerInvite, type PartnerKind } from "@/types/partner";
import { PartnerInviteDialog } from "./PartnerInviteDialog";
import { PartnerTable } from "./PartnerTable";

const COPY: Record<PartnerKind, { title: string; description: string; action: string }> = {
  Freelancer: {
    title: "Freelancers",
    description: "Independent technicians appointed as service partners.",
    action: "Invite freelancer",
  },
  Franchise: {
    title: "Franchises",
    description: "Partner firms appointed to service jobs.",
    action: "Invite franchise",
  },
};

/**
 * One screen, two kinds. Sending is the server's job: it talks to WhatsApp and
 * records the outcome, so a refused message comes back as a `failed` row with a
 * reason rather than an error that loses the record.
 */
export function PartnerListScreen({ kind }: { kind: PartnerKind }) {
  const copy = COPY[kind];
  const partnerType = PARTNER_TYPE_OF[kind];

  const [params, setParams] = useListParams();
  const { data, isLoading, isError, error, refetch } = usePartnerInvites(
    partnerType,
    params
  );
  const [dialogOpen, setDialogOpen] = useState(false);

  const create = useCreateInvite(partnerType);
  const resend = useResendInvite(partnerType);
  const cancel = useCancelInvite(partnerType);
  const { regions } = useAssignableRegions();

  return (
    <>
      <PageMeta title={copy.title} description={copy.description} />

      <PartnerTable
        kind={kind}
        invites={data?.rows}
        meta={data?.pagination}
        params={params}
        onParams={setParams}
        isLoading={isLoading}
        error={isError ? error : null}
        onRetry={() => refetch()}
        isBusy={resend.isPending || cancel.isPending}
        onResend={(invite: PartnerInvite) =>
          resend.mutate(invite.id, {
            onSuccess: (updated) =>
              toast.add({
                title:
                  updated.status === "sent"
                    ? `Invite resent to ${updated.phone}`
                    : `Still couldn't reach ${updated.phone}`,
                description: updated.failureReason ?? undefined,
              }),
          })
        }
        onCancel={(invite: PartnerInvite) =>
          cancel.mutate(invite.id, {
            onSuccess: () =>
              toast.add({ title: `Invite to ${invite.phone} cancelled` }),
          })
        }
        toolbarActions={
          <Button className="h-10" onClick={() => setDialogOpen(true)}>
            <Plus data-icon="inline-start" />
            {copy.action}
          </Button>
        }
      />

      <PartnerInviteDialog
        kind={kind}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        isSubmitting={create.isPending}
        onSubmit={(values) =>
          create.mutate(
            {
              partnerType,
              phone: toE164(values.phone),
              fullName: values.fullName.trim() || null,
              // Blank means "I hold exactly one region" — the server uses it.
              regionId: values.regionId || regions[0]?.id || null,
            },
            {
              onSuccess: (invite) => {
                // A refused message is not an error: the invite exists and can
                // be resent, so it is reported where the row now lives.
                toast.add({
                  title:
                    invite.status === "sent"
                      ? `Invite sent to ${invite.phone}`
                      : `Invite saved, but not delivered`,
                  description:
                    invite.failureReason ??
                    `They'll install the technician app and register as a ${kind.toLowerCase()}.`,
                });
                setDialogOpen(false);
              },
            }
          )
        }
      />
    </>
  );
}
