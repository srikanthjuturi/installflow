import { cn } from "@/lib/utils";

export interface BrandMarkProps {
  /** The letters in the tile — a company's `code`, or the platform mark. */
  mark: string;
  /**
   * The full name the tile abbreviates. Supply it wherever the wordmark beside
   * the tile can be hidden — collapsed, the rail is the tile and nothing else,
   * so without this the workspace becomes two unexplained letters. Given one,
   * the tile stops being decorative and carries the name instead.
   */
  label?: string;
  /**
   * `light` is the white tile used on the brand-coloured rail; `brand` is the
   * filled tile used on a page background (login, 404).
   */
  tone?: "light" | "brand";
  className?: string;
}

/**
 * The monogram tile beside the wordmark.
 *
 * One component because the same eight letters of markup had been redrawn in
 * the rail, the login panel and the 404 page, and a fourth copy sits in
 * `index.html` where it has to (it renders before any JavaScript). Divergent
 * copies of this exact tile are what commit `4b358be` had to go back and fix
 * on the mobile side, where an inlined duplicate had drifted from the real one.
 *
 * It renders whatever `mark` it is handed and resolves nothing itself — the
 * decision of whose brand to wear belongs to `useBrand`, so a caller cannot
 * accidentally pair one brand's name with another's tile.
 */
export function BrandMark({
  mark,
  label,
  tone = "light",
  className,
}: BrandMarkProps) {
  return (
    <div
      // Decorative only when the name is already legible beside it.
      {...(label
        ? { role: "img", "aria-label": label, title: label }
        : { "aria-hidden": true })}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-md text-[13px] font-bold",
        // A four- or five-letter code has to stay inside the same square the
        // two-letter one occupies — the tile is a fixed slot in the rail.
        mark.length > 3 && "text-[10px] tracking-tight",
        tone === "light"
          ? "bg-white text-brand-500"
          : "bg-brand-500 text-white",
        className
      )}
    >
      {mark}
    </div>
  );
}
