import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

/**
 * An Indian pincode never begins with 0. Stricter than the six-digit shape in
 * `companySchema`, and deliberately the same expression the API and the
 * `ck_pincodes_format` CHECK both use — this form is the one place that CREATES
 * a code, so a looser rule here would write a row the database refuses.
 */
export const PINCODE_RE = /^[1-9][0-9]{5}$/;

export const pincodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(PINCODE_RE, "Six digits, not starting with zero"),
  stateId: z.string().min(1, "Pick a state"),
  /**
   * Not `.min(1)`. Four real pincodes belong to no district at all, and a
   * superadmin who genuinely does not know one should be able to record that
   * rather than pick a neighbour and make the master quietly wrong.
   */
  districtIds: z.array(z.string()),
});

export type PincodeFormValues = z.infer<typeof pincodeSchema>;

export const pincodeResolver = () => zodResolver(pincodeSchema);

export const EMPTY_PINCODE_FORM: PincodeFormValues = {
  code: "",
  stateId: "",
  districtIds: [],
};
