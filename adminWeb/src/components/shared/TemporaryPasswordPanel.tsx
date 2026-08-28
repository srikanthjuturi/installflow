import { useState } from "react";
import { Button } from "@/components/ui/button";
import { copyToClipboard } from "@/utils/clipboard";

/**
 * Shown when an account was created (or its password reissued) but the email
 * did not go out.
 *
 * Deliberately NOT a toast, which is what every other outcome in this console
 * uses. A toast fades, and this password exists only in that one HTTP response:
 * it is stored nowhere, it is not in the list the table refetches, and it cannot
 * be recovered — staff have no password reset. A toast that disappears while the
 * manager is looking elsewhere would destroy the account.
 *
 * The technician invite's undelivered link can live in a toast precisely because
 * it does NOT have this property — it stays readable on the row forever.
 *
 * Replaces the dialog's own body, so the only way past it is to acknowledge it.
 */
export function TemporaryPasswordPanel({
  heading,
  email,
  password,
  reason,
  onDone,
}: {
  heading: string;
  email: string;
  password: string;
  /** The server's own explanation — never paraphrased into "something failed". */
  reason: string | null;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-[17px] font-semibold">{heading}</h2>
        <p className="mt-1.5 text-[13px] text-ink-2">
          {reason ?? "The email could not be sent."}
        </p>
      </div>

      <div className="grid gap-3 rounded-lg border border-line bg-surface-2 p-4">
        <div className="grid gap-1">
          <span className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">
            Email
          </span>
          <span className="text-[13px] break-all">{email}</span>
        </div>
        <div className="grid gap-1">
          <span className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">
            Temporary password
          </span>
          <code className="rounded-md border border-line bg-surface px-3 py-2 font-mono text-[15px] tracking-wide select-all">
            {password}
          </code>
        </div>
        <Button
          type="button"
          variant="outline"
          className="justify-self-start"
          onClick={() => {
            void copyToClipboard(`${email}\n${password}`).then(setCopied);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      <p className="text-[13px] text-ink-2">
        Send this to them yourself — it is not stored anywhere and cannot be
        shown again.
      </p>

      <div className="flex justify-end">
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
