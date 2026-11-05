import { useState } from "react";
import { AlertTriangle, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { CreatedApiCredential } from "@/types/integration";
import { copyToClipboard } from "@/utils/clipboard";

/**
 * The ONE place a Client Secret is ever drawn.
 *
 * The server keeps a hash and answers with the secret once, in the response that
 * creates or replaces a credential — this dialog holds that response and nothing
 * else does. Closing it drops the value: the parent clears `created`, nothing is
 * cached (the mutation result is not read from the query cache) and the list has
 * no secret field to show it from.
 *
 * Not dismissible by a backdrop click (`Dialog`'s default): a stray click must
 * not throw away the only copy. Escape and Done are the ways out, and Done is
 * where the warning is repeated.
 *
 * It also says whether the email reached the vendor, because that decides what
 * the admin has to do next: if it did not, this screen is the only copy anybody
 * has and the admin hands it over themselves.
 */
export function CredentialSecretDialog({
  created,
  onClose,
}: {
  created: CreatedApiCredential | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={created !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        {created ? <SecretBody created={created} onDone={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

const EMAIL_NOTE: Record<
  CreatedApiCredential["emailStatus"],
  { text: (error: string | null) => string; tone: string }
> = {
  sent: {
    text: () =>
      "We emailed these credentials to the vendor's primary login address.",
    tone: "bg-ok-bg text-ok",
  },
  failed: {
    text: (error) =>
      `We could not email them to the vendor${error ? ` (${error})` : ""}. This screen is the only copy — send them to the vendor yourself.`,
    tone: "bg-warn-bg text-warn",
  },
  skipped: {
    text: (error) =>
      `Nothing was emailed${error ? `: ${error}` : ""}. This screen is the only copy — send them to the vendor yourself.`,
    tone: "bg-warn-bg text-warn",
  },
};

function SecretBody({
  created,
  onDone,
}: {
  created: CreatedApiCredential;
  onDone: () => void;
}) {
  const { credential, clientSecret, emailStatus, emailError } = created;
  const email = EMAIL_NOTE[emailStatus];

  return (
    <>
      <DialogHeader>
        <DialogTitle>Credential generated</DialogTitle>
        <DialogDescription>
          For {credential.vendorName}. Enter these in the vendor&apos;s CRM, in
          its API settings.
        </DialogDescription>
      </DialogHeader>

      <div
        role="alert"
        className="flex items-start gap-2 rounded-md bg-warn-bg px-3 py-2.5 text-xs leading-relaxed font-semibold text-warn"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        Copy the Client Secret now. It will not be shown again.
      </div>

      <div className="grid gap-3">
        <CopyField label="Client ID" value={credential.clientId} />
        <CopyField label="Client Secret" value={clientSecret} secret />
      </div>

      <p
        role="status"
        className={cn(
          "rounded-md px-3 py-2.5 text-xs leading-relaxed",
          email.tone
        )}
      >
        {email.text(emailError)}
      </p>

      <DialogFooter>
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}

function CopyField({
  label,
  value,
  secret = false,
}: {
  label: string;
  value: string;
  secret?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-ink-2">{label}</div>
      <div className="flex items-start gap-2">
        {/* Selectable text rather than an input, so a long secret wraps and a
            long-press selects it on a phone. */}
        <code
          data-testid={secret ? "client-secret" : "client-id"}
          className="min-w-0 flex-1 rounded-md border border-line-2 bg-surface-2 px-3 py-2 font-mono text-xs break-all text-ink"
        >
          {value}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 shrink-0"
          aria-label={`Copy the ${label}`}
          onClick={() => {
            // Never throws — a denied clipboard degrades to "select it
            // yourself", and the value is on screen either way.
            void copyToClipboard(value).then(setCopied);
          }}
        >
          {copied ? (
            <Check data-icon="inline-start" aria-hidden />
          ) : (
            <Copy data-icon="inline-start" aria-hidden />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
