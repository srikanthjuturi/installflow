/**
 * The optional "Extra charge" on a vendor's ticket (Epic 1.4).
 *
 * The server takes `extraAmountPaise` (an integer, 1 to 10,000,000) and
 * `extraAmountNote` (up to 120 characters) as a PAIR: both or neither. Half a
 * pair is a 422, so the form refuses it first. The amount is typed in rupees,
 * with at most two decimals, and converted with `Math.round` so `3200.5` cannot
 * drift.
 */

/** ₹1,00,000 - the server's ceiling, in paise. */
export const EXTRA_AMOUNT_MAX_PAISE = 10_000_000;
export const EXTRA_NOTE_MAX = 120;

const RUPEES = /^\d+(\.\d{1,2})?$/;

/** A typed rupee amount as paise, or null when it is blank or not a plain amount. */
export function extraAmountToPaise(raw: string | undefined): number | null {
  const text = (raw ?? "").trim().replace(/,/g, "");
  if (!RUPEES.test(text)) return null;
  return Math.round(Number(text) * 100);
}

export interface ExtraChargeIssue {
  field: "extraAmount" | "extraAmountNote";
  message: string;
}

/**
 * Both or neither; the amount above zero, within the ceiling and in whole
 * paise; the note within its bound. Pure, so the schema and the tests share it.
 */
export function extraChargeIssues(
  amount: string | undefined,
  note: string | undefined
): ExtraChargeIssue[] {
  const a = (amount ?? "").trim();
  const n = (note ?? "").trim();
  const issues: ExtraChargeIssue[] = [];

  if (n.length > EXTRA_NOTE_MAX) {
    issues.push({
      field: "extraAmountNote",
      message: `Keep it under ${EXTRA_NOTE_MAX} characters`,
    });
  }
  if (!a && !n) return issues;

  if (!a) {
    issues.push({
      field: "extraAmount",
      message: "Enter the amount, or clear the note",
    });
    return issues;
  }
  if (!n) {
    issues.push({
      field: "extraAmountNote",
      message: "Say what the extra charge is for, or clear the amount",
    });
  }

  const paise = extraAmountToPaise(a);
  if (paise === null) {
    issues.push({
      field: "extraAmount",
      message: "Enter an amount in rupees, with at most two decimals",
    });
  } else if (paise <= 0) {
    issues.push({ field: "extraAmount", message: "The amount must be above zero" });
  } else if (paise > EXTRA_AMOUNT_MAX_PAISE) {
    issues.push({
      field: "extraAmount",
      message: "The amount can be at most ₹1,00,000",
    });
  }
  return issues;
}

/** What goes on the wire: both fields, or neither. Call only on validated values. */
export function extraChargePayload(
  amount: string | undefined,
  note: string | undefined
): { extraAmountPaise?: number; extraAmountNote?: string } {
  const paise = extraAmountToPaise(amount);
  const text = (note ?? "").trim();
  if (paise === null || paise <= 0 || !text) return {};
  return { extraAmountPaise: paise, extraAmountNote: text };
}
