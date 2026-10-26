import { cn } from "@/lib/utils";
import type { FranchiseeKind } from "@/types/franchisee";

/**
 * Kind and Home, as words that ride on a tint — colour alone fails WCAG 1.4.1
 * the way every badge here fails it if it only tinted.
 *
 * Kind separates "part of the company" from "a separate business", which is why
 * internal gets the brand tint and external the warn-tinted one: an external
 * franchisee is an outside party with its own login surface (F7), so the badge
 * says "treat the boundary seriously" the same way an export chip does.
 *
 * Static strings — an interpolated `bg-${kind}` is never generated (hard rule 6).
 */
const KIND_CLASS: Record<FranchiseeKind, string> = {
  internal: "bg-brand-100 text-brand-400",
  external: "bg-warn-bg text-warn",
};

export function FranchiseeBadges({
  kind,
  isHome,
}: {
  kind: FranchiseeKind;
  isHome: boolean;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.25">
      <span
        className={cn(
          "inline-block rounded-full px-2.25 py-0.75 text-[11px] font-semibold whitespace-nowrap",
          KIND_CLASS[kind]
        )}
      >
        {kind === "internal" ? "Internal" : "External"}
      </span>
      {isHome ? (
        <span className="inline-block rounded-full border border-line bg-surface-3 px-2.25 py-0.75 text-[11px] font-semibold whitespace-nowrap text-ink-2">
          Home
        </span>
      ) : null}
    </span>
  );
}