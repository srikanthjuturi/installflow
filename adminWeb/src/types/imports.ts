/** The 8 columns the template requires, in template order. */
export const REQUIRED_COLUMNS = [
  "company",
  "category",
  "customer_name",
  "mobile",
  "pincode",
  "expected_date",
  "product_model",
  "sla_type",
] as const;

export interface ImportRow {
  row: number;
  customer: string;
  pincode: string;
  mobile: string;
  /** A rejected row never blocks the rest of the file. */
  result: "Passed" | "Rejected";
  /** `—` when the row passed. */
  reason: string;
}

export interface ImportBatch {
  id: string;
  filename: string;
  size: string;
  uploadedAt: string;
  total: number;
  passed: number;
  rejected: number;
  rows: ImportRow[];
}
