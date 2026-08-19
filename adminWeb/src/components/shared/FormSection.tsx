import {
  FieldDescription,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { cn } from "@/lib/utils";

/**
 * A titled group of fields — the house pattern for sectioning a form.
 *
 * One component rather than a fieldset the caller assembles by hand, because
 * every form was building the same three pieces slightly differently: the
 * legend's weight, whether a rule appeared, and whether the hint sat above or
 * below the fields. Five forms, five near-misses.
 *
 * A real `fieldset`/`legend`, not a styled div, so a screen reader announces
 * "Statutory identity, group" as it enters and a long form is navigable rather
 * than one flat run of thirteen inputs.
 *
 * The rule runs BESIDE the heading rather than between the sections. A
 * full-width separator reads as "these two blocks are unrelated"; this reads as
 * "a new group starts here" — and it costs no vertical space, which matters in
 * a dialog holding a dozen fields. It fades out to nothing so it belongs to the
 * heading instead of looking like a border somebody forgot to finish, and it is
 * `aria-hidden` because the `legend` already conveys the grouping.
 *
 * For a sub-group INSIDE a section, use a plain `FieldSet` with its own
 * `FieldLegend`. Giving a nested group the same rule flattens the hierarchy and
 * makes it look like a peer of the section it sits in.
 */
export function FormSection({
  legend,
  hint,
  action,
  children,
  className,
  ...rest
}: {
  legend: React.ReactNode;
  /**
   * Sits under the heading, above the fields — for guidance that applies to the
   * whole group rather than one field.
   *
   * A plain string is wrapped for you. Pass an element instead when it needs
   * its own `id`, because `aria-describedby` has to point at something.
   */
  hint?: React.ReactNode;
  /**
   * A control belonging to the section — a "Select all", a count, a toggle.
   * The rule runs between the heading and it, so the two are visibly one row
   * rather than a heading with something floating beside it.
   */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /**
   * Anything else lands on the `fieldset` — `data-invalid`, `aria-invalid` and
   * `aria-describedby` for a section that is itself one validated control.
   */
} & Omit<React.ComponentProps<typeof FieldSet>, "children">) {
  return (
    <FieldSet className={cn("gap-5", className)} {...rest}>
      <div className="grid gap-0.5">
        <div className="flex items-center gap-3">
          <FieldLegend
            variant="label"
            className="mb-0 text-sm font-semibold text-ink"
          >
            {legend}
          </FieldLegend>
          <span
            className="h-px flex-1 bg-gradient-to-r from-brand-300 to-transparent opacity-70"
            aria-hidden
          />
          {action}
        </div>
        {typeof hint === "string" ? (
          <FieldDescription className="mt-0">{hint}</FieldDescription>
        ) : (
          hint
        )}
      </div>
      {children}
    </FieldSet>
  );
}
