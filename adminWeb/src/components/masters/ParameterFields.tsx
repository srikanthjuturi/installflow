import { useState } from "react";
import { Plus, X } from "lucide-react";
import {
  useFieldArray,
  useWatch,
  type Control,
  type FieldErrors,
  type FieldValues,
  type Path,
  type UseFormRegister,
} from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MAX_PARAMETERS } from "./categorySchema";

/**
 * The repeatable name/value rows — "Add field".
 *
 * Two surfaces, one control, differing only in `requireValue`:
 *
 *   * the LAST SUB-CATEGORY, where the list is a TEMPLATE — the names are the
 *     point and a value is an optional default;
 *   * the PRODUCT, which opens seeded from that template and must supply a
 *     value for every field, because this is the answer rather than the
 *     question.
 *
 * A template, not inheritance. The product owns what it saves, so editing the
 * category later changes what the NEXT product starts from and leaves existing
 * ones alone — no merge, and no precedence rule for anybody to learn.
 *
 * ## The first add/remove field array in this codebase
 *
 * `useFieldArray` already appears in `RulesForm`, but both uses there are FIXED
 * at four and never call `append` or `remove`. Two things carried over from it
 * because they are the non-obvious half:
 *
 *   * the rows are OBJECTS, not bare strings — `useFieldArray` keys on one, and
 *     that key is also what stops every input losing focus on re-render;
 *   * `fields[i].id` is the React key, never the index. Removing row 2 with an
 *     index key makes React reuse row 3's DOM node and the cursor jumps.
 *
 * The add/remove affordance follows `ModelFormDialog`'s photo strip: the Add
 * button stays mounted and goes disabled at the cap rather than vanishing, so
 * the control does not move under the pointer at the moment it stops working.
 *
 */
interface ParameterFieldsProps<T extends FieldValues> {
  control: Control<T>;
  register: UseFormRegister<T>;
  /** The field-array path. `"parameters"` on both dialogs. */
  name: Path<T>;
  errors: FieldErrors<T>;
  /** Unique per dialog, so two open forms cannot collide on input ids. */
  idPrefix: string;
  /** What the rows describe, for the empty state's sentence. */
  hint: string;
  /**
   * Is a value compulsory on every named row?
   *
   * False on the last sub-category, where the list is a TEMPLATE and a value is
   * an optional default. True on a product, where it is the answer — a named
   * field left blank would reach a technician as a blank line.
   */
  requireValue?: boolean;
  /**
   * The last sub-category's template field names, for an EXISTING product only.
   *
   * A product owns what it saved, so a field added to the category afterwards
   * never appears on it — which is correct (a value is mandatory here, and
   * silently adding an empty one would make a saved product invalid and block
   * an unrelated edit) and quietly wrong over time: nobody hand-copies a new
   * field onto two hundred products, so the catalogue drifts and no screen says
   * so.
   *
   * Passing this offers them instead of adding them. Omit it when ADDING a
   * product — a new one already starts from the whole template, so the only
   * thing the notice could ever do there is nag somebody who deleted a row on
   * purpose.
   */
  templateNames?: string[];
}

const key = (s: string | undefined) => (s ?? "").trim().toLowerCase();

export function ParameterFields<T extends FieldValues>({
  control,
  register,
  name,
  errors,
  idPrefix,
  hint,
  requireValue = false,
  templateNames,
}: ParameterFieldsProps<T>) {
  const { fields, append, remove } = useFieldArray({
    control,
    // `useFieldArray` types its `name` against the array-shaped paths of T,
    // which a generic caller cannot prove. Both dialogs pass "parameters".
    name: name as never,
  });

  // What the category has gained since this product was saved. Frozen at mount
  // from the values the form OPENED with, deliberately: recomputed live,
  // deleting a row would make the notice reappear offering it straight back,
  // and "no, this product has no Panel" is a legitimate answer.
  const [offered] = useState(() => {
    const have = new Set(
      fields.map((f) => key((f as unknown as { name?: string }).name))
    );
    return (templateNames ?? []).filter((n) => n.trim() && !have.has(key(n)));
  });
  const [takenUp, setTakenUp] = useState(false);

  // `useWatch`, not `watch()` — the React Compiler is on, and this is read on
  // every render to hide a name the moment it is typed in by hand.
  const rows = useWatch({ control, name: name as never }) as
    | { name?: string; value?: string }[]
    | undefined;
  const present = new Set((rows ?? []).map((r) => key(r.name)));
  const missing = takenUp
    ? []
    : offered.filter((n) => !present.has(key(n))).slice(0, MAX_PARAMETERS);
  const room = Math.max(0, MAX_PARAMETERS - fields.length);

  const rowErrors = errors[name as keyof typeof errors] as
    | { name?: { message?: string }; value?: { message?: string } }[]
    | undefined;
  const listError = (
    errors[name as keyof typeof errors] as { message?: string } | undefined
  )?.message;

  return (
    <Field>
      <FieldLabel htmlFor={`${idPrefix}-param-0-name`}>Fields</FieldLabel>

      {fields.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {fields.map((field, index) => (
            /* `field.id`, never `index` — see the note above. */
            <li key={field.id} className="flex items-start gap-2">
              <div className="grid flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                <div>
                  <Input
                    id={`${idPrefix}-param-${index}-name`}
                    placeholder="Field, e.g. RAM"
                    aria-label={`Field ${index + 1} name`}
                    aria-invalid={rowErrors?.[index]?.name ? true : undefined}
                    {...register(`${name}.${index}.name` as Path<T>)}
                  />
                  {rowErrors?.[index]?.name ? (
                    <FieldDescription role="alert" className="text-danger">
                      {rowErrors[index]?.name?.message}
                    </FieldDescription>
                  ) : null}
                </div>
                <div>
                  <Input
                    id={`${idPrefix}-param-${index}-value`}
                    placeholder={
                      requireValue ? "Value, e.g. 8 GB" : "Default (optional)"
                    }
                    aria-label={`Field ${index + 1} value`}
                    aria-invalid={rowErrors?.[index]?.value ? true : undefined}
                    {...register(`${name}.${index}.value` as Path<T>)}
                  />
                  {rowErrors?.[index]?.value ? (
                    <FieldDescription role="alert" className="text-danger">
                      {rowErrors[index]?.value?.message}
                    </FieldDescription>
                  ) : null}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove field ${index + 1}`}
                onClick={() => remove(index)}
              >
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {missing.length > 0 ? (
        /* An offer, never an edit. Ignoring it saves the product exactly as it
           saves today — which is the whole reason this is a notice and not a
           silent merge: the value is mandatory, so a merged-in empty row would
           block somebody who opened this dialog to change the price. */
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md bg-info-bg px-3.5 py-2.5 text-xs leading-relaxed text-info">
          <span>
            {missing.length === 1
              ? `“${missing[0]}” was added to this category after this product was saved.`
              : `${missing.length} fields were added to this category after this
                 product was saved: ${missing.join(", ")}.`}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            disabled={room === 0}
            onClick={() => {
              append(
                missing
                  .slice(0, room)
                  .map((n) => ({ name: n, value: "" })) as never
              );
              // Once, and not again for this dialog. Adding then removing one
              // is an answer, not a mistake to correct.
              setTakenUp(true);
            }}
          >
            {missing.length === 1 ? "Add it" : `Add all ${missing.length}`}
          </Button>
        </p>
      ) : null}

      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          // Mounted but disabled at the cap, so the button does not move under
          // the pointer at the moment it stops working.
          disabled={fields.length >= MAX_PARAMETERS}
          onClick={() => append({ name: "", value: "" } as never)}
        >
          <Plus data-icon="inline-start" aria-hidden />
          Add field
        </Button>
      </div>

      {listError ? (
        <FieldDescription role="alert" className="text-danger">
          {listError}
        </FieldDescription>
      ) : (
        <FieldDescription>
          {hint}
          {fields.length >= MAX_PARAMETERS
            ? ` That is the limit of ${MAX_PARAMETERS}.`
            : ""}
        </FieldDescription>
      )}
    </Field>
  );
}
