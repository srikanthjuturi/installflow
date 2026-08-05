import { mockResponse, notFound } from "./client";
import type { ImportBatch, ImportRow } from "@/types";

const pass = (row: number, customer: string, pincode: string, mobile: string): ImportRow => ({
  row,
  customer,
  pincode,
  mobile,
  result: "Passed",
  reason: "—",
});

const reject = (
  row: number,
  customer: string,
  pincode: string,
  mobile: string,
  reason: string,
): ImportRow => ({ row, customer, pincode, mobile, result: "Rejected", reason });

/**
 * The row-level verdict. Every rejection names its own reason, because the
 * ops user has to fix that row specifically — "9 rows failed" is useless.
 */
const ROWS: ImportRow[] = [
  pass(1, "Nikhil Rao", "411014", "+91 98220 11002"),
  reject(2, "Sneha Kale", "41102", "+91 90110 33421", "Invalid pincode — must be 6 digits"),
  pass(3, "Amit Verma", "411021", "+91 98765 22110"),
  reject(4, "Pooja Shah", "411038", "9822", "Malformed mobile number"),
  reject(5, "", "411045", "+91 88888 12345", "Missing required field — customer_name"),
  pass(6, "Rahul Jain", "411001", "+91 97654 88213"),
  reject(7, "Divya Menon", "560001", "+91 90040 55123", "Pincode outside serviceable territory"),
  pass(8, "Kiran Patil", "411057", "+91 99000 71122"),
  reject(9, "Sahil Kapoor", "411030", "+91 98115 00219", "Missing required field — product_model"),
];

const BATCHES = new Map<string, ImportBatch>();

let seq = 0;

/**
 * Uploads the file for server-side validation.
 *
 * Rows are never parsed in the browser: §4 makes validation an import-time
 * server responsibility, and the rules must match the ones the API applies.
 * When the backend lands this becomes a multipart POST; the shape returned
 * here is the shape it will return.
 */
export function uploadBatch(file: File): Promise<ImportBatch> {
  return mockResponse(() => {
    seq += 1;
    const batch: ImportBatch = {
      id: `BATCH-${1000 + seq}`,
      filename: file.name,
      size: `${Math.max(1, Math.round(file.size / 1024))} KB`,
      uploadedAt: "just now",
      total: 128,
      passed: 119,
      rejected: 9,
      rows: ROWS,
    };
    BATCHES.set(batch.id, batch);
    return batch;
  }, 900);
}

export function getBatch(id: string): Promise<ImportBatch> {
  return mockResponse(() => {
    const batch = BATCHES.get(id);
    if (!batch) notFound("Batch", id);
    return batch;
  });
}
