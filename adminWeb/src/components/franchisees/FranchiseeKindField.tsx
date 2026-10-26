import { ChoiceCards } from "@/components/shared/ChoiceCards";
import { KIND_OPTIONS, type KindWord } from "./franchiseeKind";

interface FranchiseeKindFieldProps {
  value: KindWord;
  onChange: (value: KindWord) => void;
  /** The company name from `useBrand()` — never a product name (trap 4). */
  company: string;
  /** On the home franchisee: locked, and the field says why. */
  locked?: boolean;
  error?: string;
  errorId?: string;
}

/**
 * Internal / External as two cards.
 *
 * The sentences differ per card and travel WITH the card — "Part of {company}."
 * belongs to Internal as surely as "A separate business…" belongs to External —
 * which is what `ChoiceCards`' per-card `descriptions` is for. Locked (the home
 * edit form), the group renders disabled and the group description becomes the
 * reason: "The home franchisee is always internal."
 *
 * The WORD/wire conversion lives beside the option list, in
 * `./franchiseeKind` — a component file may export nothing else (fast
 * refresh).
 */
export function FranchiseeKindField({
  value,
  onChange,
  company,
  locked = false,
  error,
  errorId,
}: FranchiseeKindFieldProps) {
  return (
    <ChoiceCards
      legend="Kind"
      options={KIND_OPTIONS}
      value={value}
      onChange={onChange}
      disabled={locked}
      descriptions={{
        Internal: `Part of ${company}.`,
        External: `A separate business working under the ${company} name.`,
      }}
      description={
        locked ? "The home franchisee is always internal." : undefined
      }
      error={error}
      errorId={errorId}
    />
  );
}