import { FieldDescription, FieldLegend, FieldSet } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

interface ChoiceCardsProps<T extends string> {
  /** The question, above the cards. Also the group's accessible name. */
  legend: string;
  /** The answers, in the order they should read. Two, side by side. */
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  /**
   * The group's own meaning, below the cards. When every card carries its own
   * sentence (`descriptions`) this can stay undefined — the words live on the
   * cards — but it is where a hint travels, so a locked group spells out WHY
   * here.
   */
  description?: React.ReactNode;
  /**
   * A sentence PER card, when "Internal"/"External" or "Freelancer"/"Employee"
   * mean different things — the card's description travels with the option it
   * describes, so a reader cannot pair a sentence with the wrong card.
   * The group-level `description` (below the cards) and these can coexist.
   */
  descriptions?: Partial<Record<T, React.ReactNode>>;
  /**
   * Locks the whole group — the home franchisee's kind can never change. A
   * locked group still says why: the `description` stays, as the hint.
   */
  disabled?: boolean;
  error?: string;
  errorId?: string;
}

/**
 * A boolean as two labelled cards.
 *
 * There is no `Switch` in this console and adding one would be the first: a
 * switch's two states carry no visible word, and "never colour alone" applies to
 * a control as much as to a badge. So every boolean here — Active/Paused on a
 * category, a subcategory, a model and a vendor; On/Off for a vendor's address
 * search and its location check — is one of these.
 *
 * Promoted on the THIRD consumer, which is the house habit. `StatusField`,
 * `AddressSearchField` and `LocationCheckField` are now thin typed wrappers over
 * it, and they stay separate wrappers rather than call sites passing raw strings:
 * each is typed to its own union, so a form cannot put a category status where a
 * vendor's switch goes.
 *
 * Deliberately generic over the option type rather than taking `boolean`. The
 * value a form holds is the WORD — "Active", "On" — because that word is what
 * the radio renders and what zod validates; converting to a boolean happens once,
 * at submit, where the wire shape is decided.
 */
export function ChoiceCards<T extends string>({
  legend,
  options,
  value,
  onChange,
  description,
  descriptions,
  disabled = false,
  error,
  errorId,
}: ChoiceCardsProps<T>) {
  return (
    <FieldSet data-invalid={error ? true : undefined}>
      <FieldLegend variant="label" className="text-sm font-medium">
        {legend}
      </FieldLegend>
      <RadioGroup
        aria-label={legend}
        value={value}
        onValueChange={(next) => onChange(next as T)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        disabled={disabled}
        className="grid grid-cols-2 gap-2.5"
      >
        {options.map((option) => {
          const own = descriptions?.[option];
          return (
            <label
              key={option}
              className={cn(
                "flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-[13px] transition-colors",
                disabled
                  ? "cursor-not-allowed opacity-60"
                  : "cursor-pointer hover:border-brand-400",
                value === option
                  ? "border-brand-500 bg-brand-100/40"
                  : "border-line"
              )}
            >
              <RadioGroupItem value={option} />
              <span className="min-w-0">
                <span>{option}</span>
                {/* The sentence that card alone earns — under the word, so a
                    reader sees option and meaning as one thing. */}
                {own ? (
                  <span className="mt-0.5 block text-[12px] leading-snug text-ink-3">
                    {own}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </RadioGroup>
      {description !== undefined ? (
        <FieldDescription className={disabled ? "text-ink-3" : undefined}>
          {description}
        </FieldDescription>
      ) : null}
      {error ? (
        <FieldDescription id={errorId} role="alert" className="text-danger">
          {error}
        </FieldDescription>
      ) : null}
    </FieldSet>
  );
}
