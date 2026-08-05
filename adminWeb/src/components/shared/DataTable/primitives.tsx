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
 * a tinted 10.5px uppercase header rail over hairline-separated rows.
 *
 * Prefer <DataTable/> over composing these by hand: it brings search, sorting,
 * paging and the three states with it. These stay exported for the handful of
 * places that genuinely only need the chrome.
 */

/** Header cell — tinted rail, uppercase micro-label. */
export function Th({
  className,
  ...props
}: React.ComponentProps<typeof TableHead>) {
  return (
    <TableHead
      scope="col"
      className={cn(
        "h-auto border-b border-line bg-surface-2 px-3.5 py-2.5 text-ink-3",
        "text-[10.5px] font-bold tracking-[0.05em] whitespace-nowrap uppercase",
        className
      )}
      {...props}
    />
  );
}

/** Body cell — 13px, hairline separator, vertically centred. */
export function Td({
  className,
  ...props
}: React.ComponentProps<typeof TableCell>) {
  return (
    <TableCell
      className={cn(
        "border-b border-line-2 px-3.5 py-2.75 align-middle text-[13px]",
        className
      )}
      {...props}
    />
  );
}

/** Body row — the hairline lives on the cells, so suppress the row's own. */
export function Tr({
  className,
  ...props
}: React.ComponentProps<typeof TableRow>) {
  return (
    <TableRow
      className={cn("border-0 hover:bg-surface-2", className)}
      {...props}
    />
  );
}

/** Header row — never highlights on hover; it is not a record. */
export function HeadTr({
  className,
  ...props
}: React.ComponentProps<typeof TableRow>) {
  return (
    <TableRow
      className={cn("border-0 hover:bg-transparent", className)}
      {...props}
    />
  );
}

export { Table, TableBody, TableHeader };
