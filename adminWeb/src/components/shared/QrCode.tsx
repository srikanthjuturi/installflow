import { useMemo } from "react";
import QRCode from "qrcode";
import { cn } from "@/lib/utils";

/** Modules of white around the code, inside the plate. Scanners need two. */
const QUIET_ZONE = 2;

/**
 * A QR code, drawn in the browser from the exact string given.
 *
 * Never a QR-image service: a third party would see whatever is encoded — on
 * the payment pages, a technician's UPI ID next to an amount — and an `<img>`
 * that fails to load shows the person scanning a blank box.
 * `qrcode.create` gives the module matrix and this draws it as ONE `<path>` in
 * `currentColor` — no hex (hard rule 1), no inline style (hard rule 2), and no
 * `dangerouslySetInnerHTML` from the library's own SVG string.
 *
 * **Dark-on-white in every theme.** `bg-white text-black` is fixed on purpose:
 * a scanner wants contrast and a quiet zone, and a dark-mode plate would be a
 * code the phone cannot read — the one thing it exists for.
 *
 * Only lazy pages import it — the three UPI payment pages, and the sign-in
 * pages through `BrandPanel` — so `qrcode` rides in their chunks and never in
 * the main bundle.
 */
export function QrCode({
  value,
  label,
  className,
  codeClassName = "size-56",
}: {
  /** Encoded exactly as given — never rebuilt (a UPI page passes the server's
   *  finished `upiUri`). */
  value: string;
  /** What a screen reader hears. */
  label: string;
  /** The white plate around the code. */
  className?: string;
  /** The code's own size. */
  codeClassName?: string;
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
        className={cn("block", codeClassName)}
      >
        <path d={drawn.d} fill="currentColor" />
      </svg>
    </div>
  );
}
