import {
  RESET_STEPS,
  RESET_STEP_LABELS,
  type ResetStep,
} from "@/components/auth/resetFlow";

/**
 * Where you are in the reset, as three segments.
 *
 * A sequence marker earns its place here because the content genuinely is a
 * sequence: three requests in a fixed order, each of which can send you back a
 * step. Without it the flow gives no answer to "how much of this is left",
 * which is the question somebody locked out of their account is asking.
 *
 * One device, not two. The step's name is carried by the heading directly
 * beneath it, so repeating "Step 2 of 3" in text would be a second thing
 * saying what this already says — the count reaches assistive tech through
 * `aria-valuetext` instead.
 */
export function ResetSteps({ current }: { current: ResetStep }) {
  const index = RESET_STEPS.indexOf(current);

  return (
    <div
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={RESET_STEPS.length}
      aria-valuenow={index + 1}
      aria-valuetext={`Step ${index + 1} of ${RESET_STEPS.length}: ${RESET_STEP_LABELS[current]}`}
      className="flex items-center gap-1.5"
    >
      {RESET_STEPS.map((step, i) => (
        <span
          key={step}
          className={
            "h-1 flex-1 rounded-full transition-colors duration-300 " +
            // Steps already passed and the one underway read as done; the rest
            // stay at line weight. Static classes, never interpolated (rule 6).
            (i <= index ? "bg-brand-500" : "bg-line")
          }
        />
      ))}
    </div>
  );
}
