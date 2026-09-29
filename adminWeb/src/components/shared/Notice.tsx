import type * as React from "react";
import type { AlertTriangle } from "lucide-react";

/**
 * A short coloured note above a form or a preview — "Every row can be read",
 * "Some rows change hands", "Nothing will be added".
 *
 * Promoted from `superadmin/GeoImportDialog` and `masters/SerialImportDialog`,
 * where it existed twice, byte for byte, because two usages is a coincidence
 * and the ticket importer is the third.
 *
 * It is NOT `EmptyState` (which owns a whole panel) and NOT the toaster (which
 * reports a request that failed). This says something true about data already
 * on screen.
 */
export function Notice({
  tone,
  icon: Icon,
  title,
  children,
}: {
  tone: "ok" | "warn";
  icon: typeof AlertTriangle;
  title: string;
  children: React.ReactNode;
}) {
  // Static class strings — an interpolated `bg-${tone}-bg` is never generated
  // (hard rule 6).
  const skin =
    tone === "ok"
      ? "border-ok/30 bg-ok-bg text-ok"
      : "border-warn/30 bg-warn-bg text-warn";
  return (
    <div className={`flex gap-2.5 rounded-lg border px-3 py-2.5 ${skin}`}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="grid gap-0.5">
        <p className="text-[13px] font-medium">{title}</p>
        <p className="text-[12px] text-ink-2">{children}</p>
      </div>
    </div>
  );
}
