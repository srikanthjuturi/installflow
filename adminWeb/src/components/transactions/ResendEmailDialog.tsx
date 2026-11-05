import { useState } from "react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { useResendEmails } from "@/hooks/useTransactions";
import { rangeProblem, type DateRange } from "@/lib/transactionPeriod";
import { formatDate } from "@/utils/datetime";

const ALL_COMPANIES = "all";

/**
 * "Re-send by email" - puts the documents in the chosen period back in the
 * queue; the server emails them to the company's Admins within minutes. Nothing
 * is sent from here, so a range of hundreds never holds a request open.
 *
 * The superadmin may name a company; a company's own Admin never does (the
 * server scopes them, and the console never sends a company id it was not
 * given). The period is the page's own, so what is re-sent is what the table
 * shows.
 */
export function ResendEmailDialog({
  open,
  onOpenChange,
  range,
  isSuperadmin,
  companies,
  companyId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  range: DateRange;
  isSuperadmin: boolean;
  companies?: { id: string; name: string }[];
  /** The page's company filter, to start from. */
  companyId?: string;
}) {
  const resend = useResendEmails();
  const [onlyUnsent, setOnlyUnsent] = useState(true);
  const [company, setCompany] = useState<string>(companyId ?? ALL_COMPANIES);
  const problem = rangeProblem(range);

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Re-send documents by email"
      description={`Queue the documents from ${formatDate(range.from)} to ${formatDate(range.to)} to be emailed again to the company's Admins. They go out within a few minutes.`}
      confirmLabel="Re-send"
      isPending={resend.isPending}
      onConfirm={() => {
        if (problem) return;
        resend.mutate(
          {
            from: range.from,
            to: range.to,
            onlyUnsent,
            ...(isSuperadmin && company !== ALL_COMPANIES ? { companyId: company } : {}),
          },
          {
            onSuccess: (r) => {
              toast.add({
                title: `${r.queued} ${r.queued === 1 ? "document" : "documents"} queued`,
                description: "They will be emailed within minutes.",
              });
              onOpenChange(false);
            },
          }
        );
      }}
    >
      <div className="grid gap-3">
        {isSuperadmin ? (
          <div className="grid gap-1.5">
            <Label htmlFor="resend-company">Company</Label>
            <Select
              value={company}
              onValueChange={(v) => v && setCompany(v)}
            >
              <SelectTrigger id="resend-company">
                <SelectValue>
                  {(v: string) =>
                    v === ALL_COMPANIES
                      ? "All companies"
                      : (companies?.find((c) => c.id === v)?.name ?? v)
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_COMPANIES}>All companies</SelectItem>
                {(companies ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <div className="flex items-start gap-2">
          <Checkbox
            id="resend-only-unsent"
            checked={onlyUnsent}
            onCheckedChange={(next) => setOnlyUnsent(next === true)}
          />
          <Label htmlFor="resend-only-unsent" className="leading-snug font-normal">
            Only documents whose email failed or was skipped
          </Label>
        </div>

        {problem ? (
          <p role="alert" className="text-xs text-danger">
            {problem}
          </p>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}
