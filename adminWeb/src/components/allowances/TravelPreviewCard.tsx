import { useState } from "react";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { TravelRule } from "@/types/allowances";
import { describeTravel } from "./travelPreview";

/**
 * The worked example under a card — a mirror of the server's arithmetic
 * (`travelPreview.ts`), fed by what the admin is TYPING, so they see the rupees
 * move before saving anything. The straight-line box is local and never saved;
 * it opens on 21.6 km, which is the index §3.5 example.
 *
 * `rule` is null while a box does not yet hold a number — then there is nothing
 * honest to compute, and the result area stays empty.
 */
export function TravelPreview({
  id,
  rule,
}: {
  /** Prefix for the input's id — two cards on one page need two ids. */
  id: string;
  rule: TravelRule | null;
}) {
  const [straight, setStraight] = useState("21.6");
  const km = Number(straight);
  const worked =
    rule && straight.trim() !== "" && Number.isFinite(km)
      ? describeTravel(km, rule)
      : null;

  return (
    <div className="rounded-md border border-dashed border-line bg-surface-2 px-3.5 py-3">
      <div className="text-xs font-semibold text-ink-2">Worked example</div>
      <Field className="mt-2">
        <FieldLabel htmlFor={`${id}-straight`} className="text-xs">
          Straight-line distance to the customer (km)
        </FieldLabel>
        <Input
          id={`${id}-straight`}
          inputMode="decimal"
          className="max-w-32"
          value={straight}
          onChange={(e) => setStraight(e.target.value)}
        />
      </Field>
      {/* aria-live: the lines change as the admin types in the card above. */}
      <div aria-live="polite" className="mt-2.5 text-[13px] leading-relaxed">
        {worked ? (
          <>
            {worked.lines.map((line) => (
              <p key={line} className="text-ink-2">
                {line}
              </p>
            ))}
            <p className="mt-0.5 font-semibold text-ink">{worked.verdict}</p>
          </>
        ) : null}
      </div>
    </div>
  );
}
