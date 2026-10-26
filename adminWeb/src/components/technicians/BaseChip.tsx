import { cn } from "@/lib/utils";
import { baseChip } from "./baseLocation";

/**
 * The base's SOURCE as a chip (R9): *Pincode · GPS · Map · Set by admin*. A
 * word always rides with the tint — never colour alone. Drawn by the profile's
 * panel and the roster's Base column, so it lives apart from the dialog the
 * panel owns (a table must not load a form).
 */
export function BaseChip({
  source,
  className,
}: {
  source: string;
  className?: string;
}) {
  const chip = baseChip(source);
  return (
    <span
      className={cn(
        "inline-block rounded-full px-2.25 py-0.75 text-[11px] font-semibold",
        chip.class,
        className
      )}
    >
      {chip.label}
    </span>
  );
}
