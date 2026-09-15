import { useMemo } from "react";
import QRCode from "qrcode";
import { cn } from "@/lib/utils";

/** Modules of white around the code, inside the plate. Scanners need two. */
const QUIET_ZONE = 2;

/**
 * A UPI payment QR, drawn in the browser from the server's finished string.
 *
 * Never a QR-image service: a third party would see a technician's UPI ID next
 * to an amount, and an `<img>` that fails to load shows the payer a blank box.
 * `qrcode.create` gives the module matrix and this draws it as ONE `<path>` in
 * `currentColor` — no hex (hard rule 1), no inline style (hard rule 2), and no
 * `dangerouslySetInnerHTML` from the library's own SVG string.
 *
 * **Dark-on-white in every theme.** `bg-white text-black` is fixed on purpose:
 * a scanner wants contrast and a quiet zone, and a dark-mode plate would be a
 * code the payer's phone cannot read — the one thing it exists for.
 *
 * Only the redemption detail page imports this, so `qrcode` rides in that
 * page's lazy chunk and never in the vendor bundle.
 */
export function UpiQr({
  value,
  label,
  className,
}: {
  /** The server's `upiUri`. Encoded exactly as given — never rebuilt. */
  value: string;
  /** What a screen reader hears — the amount and the payee. */
  label: string;
  className?: string;
}) {
  const drawn = useMemo(() => {
    // Error-correction M: the level UPI apps' own codes use.
    const { modules } = QRCode.create(value, { errorCorrectionLevel: "M" });
    const n = modules.size;
    let d = "";
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        if (modules.get(x, y)) d += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`;
      }
    }
    return { d, extent: n + QUIET_ZONE * 2 };
  }, [value]);

  return (
    <div className={cn("rounded-xl bg-white p-2 text-black", className)}>
      <svg
        viewBox={`0 0 ${drawn.extent} ${drawn.extent}`}
        role="img"
        aria-label={label}
        shapeRendering="crispEdges"
        className="block size-56"
      >
        <path d={drawn.d} fill="currentColor" />
      </svg>
    </div>
  );
}
