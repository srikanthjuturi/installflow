import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * The approved table treatment, in one place.
 *
 * shadcn's defaults are a general-purpose table; the prototype's is specific —
 * a tinted 10.5px uppercase header rail over hairline-separated rows. Nine
 * screens use it, so it lives here rather than being re-typed per table.
 */

/** Header cell — tinted rail, uppercase micro-label. */
export function Th({ className, ...props }: React.ComponentProps<typeof TableHead>) {
  return (
    <TableHead
      className={cn(
        "bg-surface-2 text-ink-3 border-line h-auto border-b px-3.5 py-2.5",
        "text-[10.5px] font-bold tracking-[0.05em] whitespace-nowrap uppercase",
        className,
      )}
      {...props}
    />
  );
}

/** Body cell — 13px, hairline separator, vertically centred. */
export function Td({ className, ...props }: React.ComponentProps<typeof TableCell>) {
  return (
    <TableCell
      className={cn("border-line-2 border-b px-3.5 py-2.75 align-middle text-[13px]", className)}
      {...props}
    />
  );
}

/** Body row — the hairline lives on the cells, so suppress the row's own. */
export function Tr({ className, ...props }: React.ComponentProps<typeof TableRow>) {
  return <TableRow className={cn("hover:bg-surface-2 border-0", className)} {...props} />;
}

/** Header row — never highlights on hover; it is not a record. */
export function HeadTr({ className, ...props }: React.ComponentProps<typeof TableRow>) {
  return <TableRow className={cn("border-0 hover:bg-transparent", className)} {...props} />;
}

export { Table, TableBody, TableHeader };
