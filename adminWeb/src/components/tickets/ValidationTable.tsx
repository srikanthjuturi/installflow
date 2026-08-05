import { CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  HeadTr,
  Table,
  TableBody,
  TableHeader,
  Td,
  Th,
  Tr,
} from "@/components/shared/DataTable";
import { TableSkeleton } from "@/components/shared/states";
import type { ImportRow } from "@/types";

const COLUMNS = ["Row", "Customer", "Pincode", "Mobile", "Result", "Reason"];

export function ValidationTable({
  rows,
  isLoading,
}: {
  rows?: ImportRow[];
  isLoading: boolean;
}) {
  return (
    <div className="scroll-x">
      <Table className="min-w-180">
        <TableHeader>
          <HeadTr>
            {COLUMNS.map((c) => (
              <Th key={c}>{c}</Th>
            ))}
          </HeadTr>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableSkeleton rows={9} cols={COLUMNS.length} />
          ) : (
            rows?.map((r) => {
              const failed = r.result === "Rejected";
              const Icon = failed ? XCircle : CheckCircle2;
              return (
                // Tint the failed row, but never rely on it — the icon and
                // the word "Rejected" carry the verdict on their own.
                <Tr key={r.row} className={cn(failed && "bg-danger-bg/40")}>
                  <Td className="text-ink-3 font-mono text-xs">#{r.row}</Td>
                  <Td>{r.customer || <span className="text-ink-3">—</span>}</Td>
                  <Td className="font-mono text-xs">{r.pincode}</Td>
                  <Td className="font-mono text-xs">{r.mobile}</Td>
                  <Td>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 text-xs font-semibold",
                        failed ? "text-danger" : "text-ok",
                      )}
                    >
                      <Icon className="size-3.5" aria-hidden />
                      {r.result}
                    </span>
                  </Td>
                  <Td className={cn("text-xs", failed ? "text-danger" : "text-ink-3")}>
                    {r.reason}
                  </Td>
                </Tr>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
