import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FranchiseeOption } from "@/types/franchisee";

/**
 * The staff Franchisee selector (Task 09 §5.10) — whose pool of money a
 * screen is reading.
 *
 * Both Penalty & Bonus and Redemptions share it for the reason the two screens
 * already share their tables: the semantics are identical (default home, the
 * selection in `?franchiseeId=`, everything else the server owns), so the
 * control is built once and never disagrees with itself.
 *
 * `null` IS home, not just "unset" — the server's own default — so home sits
 * in the list under a synthetic `"__home__"` value rather than its real id,
 * and the page's param stays ABSENT when home is read. Sending home's real id
 * would ask for the same pool the absent default names, but a URL that reads
 * `?franchiseeId=<home uuid>` everywhere would make the default look like an
 * edit rather than a default.
 *
 * One list feeds it: `useFranchiseeOptions`, which is active and inactive both
 * for the reason that service records — a paused franchisee's technicians and
 * money still need reading somewhere. The screen owns the query (`enabled` is
 * its gate); the picker owns only the choice.
 */
const HOME_VALUE = "__home__";

export const FRANCHISEE_PARAM = "franchiseeId";

interface FranchiseePickerProps {
  options?: FranchiseeOption[];
  /** The named (non-home) franchisee's id, or null — the home default. */
  value: string | null;
  onChange: (id: string | null) => void;
  /** Grayed while whoever renders me cannot pick, with its own reason why. */
  disabled?: boolean;
}

export function FranchiseePicker({
  options,
  value,
  onChange,
  disabled,
}: FranchiseePickerProps) {
  // The home row is pinned FIRST and suffixed, exactly as the approved mock
  // orders it: the default is the anchor the reader returns to, and "(home)"
  // is the word the screens use for the company's own franchisee.
  const home = options?.find((o) => o.isHome);
  const items = [
    { value: HOME_VALUE, label: home ? `${home.name} (home)` : "Home" },
    ...(options ?? [])
      .filter((o) => !o.isHome)
      .map((o) => ({ value: o.id, label: o.name })),
  ];

  return (
    // Base UI types the change as `string | null` (a clearing select can send
    // null); every option names a real franchisee, so null is dropped.
    <Select
      value={value ?? HOME_VALUE}
      onValueChange={(v: string | null) => {
        if (!v) return;
        onChange(v === HOME_VALUE ? null : v);
      }}
      disabled={disabled}
    >
      <SelectTrigger size="sm" className="min-w-56" aria-label="Franchisee">
        <SelectValue>
          {items.find((i) => i.value === value)?.label ?? items[0].label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value}>
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}