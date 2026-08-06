import { useState } from "react";
import { Plus } from "lucide-react";
import { PartnerInviteDialog } from "@/components/partners/PartnerInviteDialog";
import { PartnerTable } from "@/components/partners/PartnerTable";
import { PageMeta } from "@/components/shared/PageMeta";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useListParams } from "@/hooks/useListParams";
import { useCreatePartner, usePartners } from "@/hooks/usePartners";
import { useSession } from "@/store/session";
import type { ListParams } from "@/types/api";
import type { PartnerKind } from "@/types";

const COPY: Record<
  PartnerKind,
  { title: string; description: string; action: string }
> = {
  Freelancer: {
    title: "Freelancers",
    description: "Independent technicians appointed as service partners.",
    action: "Create freelancer",
  },
  Franchise: {
    title: "Franchises",
    description: "Partner firms appointed to service jobs.",
    action: "Create franchise",
  },
};

/**
 * Both partner screens are the same screen — a server-paged table and one
 * dialog that appoints by mobile number. The kind picks the list and the copy.
 */
export function PartnerListScreen({ kind }: { kind: PartnerKind }) {
  const copy = COPY[kind];
  const [isDialogOpen, setDialogOpen] = useState(false);
  const create = useCreatePartner(kind);

  // Who appointed them is part of the record. The scope the console is being
  // viewed as is what gets stamped — the server is still the authority on
  // whether this role may appoint at all.
  const role = useSession((s) => s.role);

  // The query the server answers. Search, filters, sort and page all live in
  // one object so the table can hand back a whole new intent in one call.
  const [params, setParams] = useListParams({ sortBy: "id", sortDir: "asc" });

  /**
   * Merged into the current query, not swapped for it — "Clear filters" resets
   * the search box and every filter in the same tick, and a setter that
   * replaced would let the last of those calls put the search term back.
   */
  const applyParams = (next: ListParams) =>
    setParams((prev) => ({
      ...prev,
      ...next,
      filters: { ...prev.filters, ...next.filters },
    }));

  const { data, isLoading, isError, error, refetch } = usePartners(
    kind,
    params
  );

  return (
    <>
      <PageMeta title={copy.title} description={copy.description} />

      <PartnerInviteDialog
        kind={kind}
        open={isDialogOpen}
        onOpenChange={setDialogOpen}
        isSubmitting={create.isPending}
        onSubmit={(values) =>
          create.mutate(
            { phone: values.phone, appointedBy: role },
            {
              onSuccess: (partner) => {
                toast.add({
                  title: `${partner.phone} invited`,
                  description: `${partner.id} · invite sent, awaiting registration.`,
                });
                setDialogOpen(false);
              },
              // A duplicate number comes back 409 — it belongs on the dialog
              // that submitted it, not on a page the reader has moved past.
              onError: (err) =>
                toast.add({
                  title: `Couldn't create the ${kind.toLowerCase()}`,
                  description: err.message,
                }),
            }
          )
        }
      />

      <PartnerTable
        kind={kind}
        partners={data?.rows}
        meta={data?.pagination}
        params={params}
        onParams={applyParams}
        isLoading={isLoading}
        error={isError ? error : null}
        onRetry={() => refetch()}
        toolbarActions={
          <Button className="h-10" onClick={() => setDialogOpen(true)}>
            <Plus data-icon="inline-start" />
            {copy.action}
          </Button>
        }
      />
    </>
  );
}
