import { useState } from "react";
import { Plus } from "lucide-react";
import { ApiCredentialTable } from "@/components/integrations/ApiCredentialTable";
import { CredentialSecretDialog } from "@/components/integrations/CredentialSecretDialog";
import { GenerateCredentialDialog } from "@/components/integrations/GenerateCredentialDialog";
import { PageMeta } from "@/components/shared/PageMeta";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  useApiCredentials,
  useReplaceApiCredential,
  useRevokeApiCredential,
} from "@/hooks/useApiCredentials";
import type { ApiCredential, CreatedApiCredential } from "@/types/integration";

/**
 * A vendor's CRM credentials — Admin and National Head (`integrations.manage`).
 *
 * One credential belongs to ONE vendor; a CRM holding it can create and read that
 * vendor's tickets and nobody else's. Several can be Active at once, which is
 * what lets a vendor switch to a new one with no break.
 *
 * ## The secret
 *
 * Shown once, in `CredentialSecretDialog`, straight from the response that made
 * it. This page keeps it in component state only so the dialog can draw it, and
 * clears it the moment the dialog closes — it is never put in the query cache,
 * the URL or storage.
 *
 * ## Replace is not a swap
 *
 * It makes a NEW credential and leaves the old one running until it is revoked,
 * so a vendor's CRM can be moved over without an outage. The confirmation says
 * so, because the word on its own reads as a swap.
 */
export default function ApiCredentialsPage() {
  const credentials = useApiCredentials();
  const replace = useReplaceApiCredential();
  const revoke = useRevokeApiCredential();

  const [generating, setGenerating] = useState(false);
  const [replacing, setReplacing] = useState<ApiCredential | null>(null);
  const [revoking, setRevoking] = useState<ApiCredential | null>(null);
  // The one-time response, held only while its dialog is open.
  const [created, setCreated] = useState<CreatedApiCredential | null>(null);

  return (
    <>
      <PageMeta
        title="API credentials"
        description="Client IDs and secrets that let a vendor's own system send you tickets"
      />
      <h2 className="sr-only">API credentials</h2>

      <ApiCredentialTable
        rows={credentials.data}
        isLoading={credentials.isLoading}
        error={credentials.isError ? credentials.error : null}
        onRetry={() => credentials.refetch()}
        onReplace={setReplacing}
        onRevoke={setRevoking}
        toolbarActions={
          <Button type="button" onClick={() => setGenerating(true)}>
            <Plus data-icon="inline-start" aria-hidden />
            Generate credential
          </Button>
        }
      />

      <GenerateCredentialDialog
        open={generating}
        onOpenChange={setGenerating}
        onCreated={setCreated}
      />

      <CredentialSecretDialog created={created} onClose={() => setCreated(null)} />

      <ConfirmDialog
        open={replacing !== null}
        onOpenChange={(open) => {
          if (!open) setReplacing(null);
        }}
        title={`Replace ${replacing?.clientId ?? "this credential"}?`}
        description={
          <>
            This makes a <b>new</b> credential for {replacing?.vendorName}. The
            old one keeps working until you revoke it, so their CRM can be moved
            over without a break.
          </>
        }
        confirmLabel="Generate a new credential"
        isPending={replace.isPending}
        onConfirm={() => {
          if (!replacing) return;
          replace.mutate(replacing.id, {
            onSuccess: (result) => {
              setReplacing(null);
              setCreated(result);
            },
          });
        }}
      />

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        title={`Revoke ${revoking?.clientId ?? "this credential"}?`}
        description={
          <>
            {revoking?.vendorName}&apos;s CRM can no longer get or use tokens with
            it, straight away. This cannot be undone — generate a new credential
            if they need one.
          </>
        }
        confirmLabel="Revoke credential"
        isPending={revoke.isPending}
        onConfirm={() => {
          if (!revoking) return;
          revoke.mutate(revoking.id, { onSuccess: () => setRevoking(null) });
        }}
      />
    </>
  );
}
