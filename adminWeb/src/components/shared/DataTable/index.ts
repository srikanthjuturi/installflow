export { DataTable } from "./DataTable";
// Exported for the one screen that is a list of CARDS rather than a table and
// still needs the same search box and filter pills — the escalation queue.
// Sharing the control means a manager learns one toolbar, not two.
export { Toolbar } from "./Toolbar";
export {
  Th,
  Td,
  Tr,
  HeadTr,
  Table,
  TableBody,
  TableHeader,
} from "./primitives";
export type {
  Column,
  TypedFilterDef,
  SortState,
  DataTableProps,
} from "./types";
