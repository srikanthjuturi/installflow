import { z } from "zod";
import { moneyPaise } from "@/utils/money";

/**
 * The force-close form's schema — moved out of `ForceCloseForm.tsx` (Task 13
 * §5.8) because the travel field's CAP is data: it comes from the ticket's
 * frozen `travel.forceCloseMaxPaise`, so the schema became a factory.
 *
 * Attachments are the whole point of the screen: §10 requires supporting
 * documents and images, and records who closed the ticket, when and on what
 * basis. The API rejects an empty list with a 422 — this schema stops it ever
 * getting that far.
 *
 * The field holds real `File` objects, not names. It used to hold `file.name`
 * strings, which meant the form collected evidence and then threw the bytes
 * away. They are uploaded on submit, and what the API stores is the blob name
 * each upload returns.
 *
 * @param travelMaxPaise the frozen per-job ceiling (`maxPaisePerJob`), or
 *   `null` when the field is not shown — then the value is not capped (it is
 *   never sent either; `ForceClosePage` omits it, which the API reads as
 *   "pay nothing").
 */
export const forceCloseSchema = (travelMaxPaise: number | null) =>
  z.object({
    reason: z.string().min(1, "Select a reason for force-closure"),
    notes: z
      .string()
      .trim()
      .min(10, "Describe the attempts made — the note is kept for audit"),
    attachments: z
      .array(z.instanceof(File))
      .min(1, "At least one supporting document or image is required")
      .max(10, "Ten attachments is the most this records"),
    /**
     * What to credit the technician, in whole RUPEES as typed. Empty means
     * nothing — which is a real answer here, not a skipped field.
     *
     * Only shown when a technician is actually assigned; the schema keeps the
     * key unconditionally so the form's type does not change shape between
     * renders.
     */
    technicianPayout: z
      .string()
      .trim()
      .refine(
        (v) => v === "" || /^\d{1,7}$/.test(v),
        "Enter a whole number of rupees"
      ),
    /**
     * What to BILL the vendor for the same job, in whole RUPEES as typed. Empty
     * means nothing, which is a real answer: a ticket whose customer never
     * confirmed a slot had nobody attend, and billing the vendor for it would
     * charge them for our own unfilled appointment.
     *
     * Independent of the payout above, and nothing here couples them. Always
     * shown, unlike the payout — every ticket has a vendor.
     */
    vendorCharge: z
      .string()
      .trim()
      .refine(
        (v) => v === "" || /^\d{1,9}$/.test(v),
        "Enter a whole number of rupees"
      ),
    /**
     * The travel allowance to credit (Task 10 TA6), in whole RUPEES as typed;
     * empty = pay nothing. Capped at the frozen `maxPaisePerJob` — the server
     * caps too, and says so; this puts the sentence on the field first.
     *
     * Present in the type unconditionally, like the payout above; it is shown
     * only when the ticket carries a travel block with a ceiling above ₹0.
     */
    travelAllowance: z
      .string()
      .trim()
      .refine(
        (v) => v === "" || /^\d{1,7}$/.test(v),
        "Enter a whole number of rupees"
      )
      .refine(
        (v) =>
          travelMaxPaise === null ||
          v === "" ||
          !/^\d{1,7}$/.test(v) ||
          Number(v) * 100 <= travelMaxPaise,
        travelMaxPaise === null
          ? "Enter a whole number of rupees"
          : `At most ${moneyPaise(travelMaxPaise)}`
      ),
  });

export type ForceCloseFormValues = z.infer<ReturnType<typeof forceCloseSchema>>;
