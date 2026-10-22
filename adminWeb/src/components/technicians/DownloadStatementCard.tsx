import { useState } from "react";
import { Download } from "lucide-react";
import { StatementMonthPicker } from "@/components/franchise/StatementMonthPicker";
import {
  defaultStatementMonth,
  statementFileName,
  statementMonths,
} from "@/components/franchise/statements";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { useBrand } from "@/hooks/useBrand";
import { useStatementDownload } from "@/hooks/useFranchise";
import type { Technician } from "@/types/technician";

/**
 * §5.10 — the home employee's statement, on their profile.
 *
 * An employee is salaried (Task 06): their travel, speed rewards, penalties
 * and bonuses land on a monthly CSV payroll adds to salary, and the portal's
 * franchisee reaches it from Employee statements (§5.6). Staff reach it HERE —
 * the month picker and the download are the §5.6 toolbar's twins, fetching the
 * same artifact through the workspace adapter so the file naming cannot drift
 * between the two doors.
 *
 * The picker defaults to the PREVIOUS IST month (`defaultStatementMonth`),
 * because payroll runs after a month closes.
 *
 * Visibility — ops workspace, employee, HOME franchisee only, National Head
 * and above (`ALL_INDIA_ROLES`, the server's own rank floor on
 * `GET /ledger/statements`) — is computed by the profile page, which knows the
 * workspace and the session. A non-home employee's statement is downloaded by
 * their own franchisee admin; a Regional Head or Area Manager can open this
 * profile but would be refused the endpoint before the click, so they are not
 * offered one either.
 *
 * Copy is the mock's (`09e-staff-console-changes`), approved §5.10. The mock's
 * endpoint/rank dev-note is not rendered — it restates the gate this page
 * already enforces and a `GET` path a console user does not call themselves.
 */
export function DownloadStatementCard({ tech }: { tech: Technician }) {
  const brand = useBrand();
  const [month, setMonth] = useState(() => defaultStatementMonth().value);
  const download = useStatementDownload();
  const label =
    statementMonths().find((m) => m.value === month)?.label ?? month;
  const fileName = statementFileName({
    company: brand.name,
    franchisee: tech.franchiseeName,
    code: tech.code,
    month,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Download statement</CardTitle>
        <CardDescription className="text-xs">
          Travel, speed rewards, penalties and bonuses for the month, to add to
          salary
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-start gap-2.5">
          <StatementMonthPicker
            value={month}
            onChange={setMonth}
            disabled={download.isPending}
          />
          <Button
            type="button"
            size="sm"
            disabled={download.isPending}
            onClick={() =>
              download.mutate(
                {
                  technicianId: tech.id,
                  code: tech.code,
                  month,
                  company: brand.name,
                  franchisee: tech.franchiseeName,
                },
                {
                  onSuccess: () => {
                    toast.add({
                      title: "Statement downloaded",
                      description: `${tech.name}, ${label}`,
                    });
                  },
                }
              )
            }
          >
            <Download data-icon="inline-start" aria-hidden />
            Download statement
            <span className="sr-only"> for {label}</span>
          </Button>
        </div>
        {/* The one sentence of the mock's hint a reader acts on, plus the
            name the file carries (the console names it, since the server's
            Content-Disposition is not CORS-exposed). */}
        <p className="mt-2.5 text-xs leading-relaxed text-ink-3">
          Defaults to the previous IST month, since payroll runs after a month
          closes. File: <span className="font-mono text-[11px]">{fileName}</span>
        </p>
      </CardContent>
    </Card>
  );
}