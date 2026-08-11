import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { cn } from "@/lib/utils";
import { ICON_KEYS, PRODUCT_ICONS, iconLabel, type IconKey } from "./icons";

interface IconPickerProps {
  value: IconKey | null;
  onChange: (value: IconKey) => void;
  /** Names the group for assistive tech — there is no visible legend inside. */
  label: string;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  /**
   * Rendered as a first "inherit" choice. Only subcategories offer it: their
   * icon is nullable and falls back to the parent category's.
   */
  inheritFrom?: { iconKey: IconKey; label: string };
  onInherit?: () => void;
}

/**
 * Interaction styles shared by every tile — the inherit pill and the icon
 * squares behave identically, only their box differs.
 *
 * Hover is scoped to `data-unchecked` so the selected tile keeps its brand
 * colours while the pointer crosses it on the way to another icon. The brand
 * ramp is a dark navy, so a hover that only shifts the glyph's ink is
 * invisible — the tint, the border and the lift are what make it read.
 */
const TILE_INTERACTION = cn(
  "cursor-pointer outline-none",
  "transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out",
  "data-unchecked:hover:border-brand-400 data-unchecked:hover:bg-brand-100",
  "data-unchecked:hover:text-brand-400 data-unchecked:hover:shadow-md",
  /* Lift only — no scale. A scaled tile widens the grid's scrollable overflow,
     and the rightmost one puts a horizontal scrollbar on the dialog. An upward
     translate and a shadow cost no layout. */
  "motion-safe:data-unchecked:hover:-translate-y-0.5",
  "focus-visible:ring-3 focus-visible:ring-brand-500/40",
  "data-checked:border-brand-500 data-checked:bg-brand-100 data-checked:text-brand-500",
  "data-checked:hover:bg-brand-200",
  "active:translate-y-0 active:shadow-none"
);

/**
 * A grid of icons, one selectable.
 *
 * Built on the base-ui radio primitives rather than `components/ui/radio-group`
 * — that wrapper hardcodes the dot indicator, and here the tile itself is the
 * control. Radio semantics are the right ones regardless: one choice from a
 * closed set, arrow keys move within the group, and only the selected tile is
 * in the tab order.
 *
 * The set is closed because the technician app hand-traces its SVGs; an icon
 * that is not in `masters/icons.ts` has nothing to draw on a phone.
 */
export function IconPicker({
  value,
  onChange,
  label,
  id,
  inheritFrom,
  onInherit,
  ...aria
}: IconPickerProps) {
  const InheritIcon = inheritFrom ? PRODUCT_ICONS[inheritFrom.iconKey] : null;

  return (
    <RadioGroup
      id={id}
      aria-label={label}
      value={value ?? "__inherit__"}
      onValueChange={(next) => {
        if (next === "__inherit__") onInherit?.();
        else onChange(next as IconKey);
      }}
      className="flex flex-wrap gap-1.5"
      {...aria}
    >
      {inheritFrom && InheritIcon ? (
        <Radio.Root
          value="__inherit__"
          className={cn(
            "flex h-11 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium",
            "border-line-2 text-ink-3",
            TILE_INTERACTION
          )}
        >
          <InheritIcon className="size-4.5" aria-hidden />
          {inheritFrom.label}
        </Radio.Root>
      ) : null}

      {ICON_KEYS.map((key) => {
        const Icon = PRODUCT_ICONS[key];
        return (
          <Radio.Root
            key={key}
            value={key}
            /* The icon carries no meaning to a screen reader, so the accessible
               name is the label and the glyph is hidden. */
            aria-label={iconLabel(key)}
            title={iconLabel(key)}
            className={cn(
              "grid size-11 place-items-center rounded-lg border",
              "border-line-2 text-ink-2",
              TILE_INTERACTION
            )}
          >
            <Icon className="size-5" aria-hidden />
          </Radio.Root>
        );
      })}
    </RadioGroup>
  );
}
