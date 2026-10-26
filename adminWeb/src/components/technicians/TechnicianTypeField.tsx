import { ChoiceCards } from "@/components/shared/ChoiceCards";
import { TYPE_OPTIONS, type TypeWord } from "./technicianType";

/**
 * Freelancer / Employee as two cards.
 *
 * The sentence each card earns travels WITH it (ChoiceCards' per-card
 * `descriptions`), because "Paid for each job they close" and "On salary" are
 * opposite answers to the same question — what happens to this person's
 * money — and the reader is choosing between those two sentences more than
 * between two words. The group hint below the cards says WHEN a change bites:
 * the job already accepted is priced the way it was accepted.
 *
 * The WORD/wire conversion lives beside the option list, in
 * `./technicianType` — a component file may export nothing else (fast
 * refresh).
 */
export function TechnicianTypeField({
  value,
  onChange,
  error,
  errorId,
}: {
  value: TypeWord;
  onChange: (value: TypeWord) => void;
  error?: string;
  errorId?: string;
}) {
  return (
    <ChoiceCards
      legend="Type"
      options={TYPE_OPTIONS}
      value={value}
      onChange={onChange}
      descriptions={{
        Freelancer: "Paid for each job they close.",
        Employee: "On salary: no per-job payout and no redemptions. Allowances and penalties still apply.",
      }}
      description="A change applies to jobs accepted after it."
      error={error}
      errorId={errorId}
    />
  );
}