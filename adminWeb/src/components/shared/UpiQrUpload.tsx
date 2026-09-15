import { useCallback, useState } from "react";
import jsQR from "jsqr";
import { QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useImagePicker, type PickedImage } from "@/components/shared/useImagePicker";
import { parseUpiQr, type ScannedUpi } from "@/lib/parseUpiQr";

/** Longest edge an uploaded QR is decoded at. jsQR's cost is quadratic in
 *  pixel count, and a phone screenshot can be 4000px+ on its long edge —
 *  well past anything a printed or on-screen QR needs to be read. */
const MAX_EDGE = 1200;

async function decode(picked: PickedImage): Promise<string | null> {
  const img = new Image();
  img.src = picked.url;
  await img.decode();

  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, width, height);
  const found = jsQR(ctx.getImageData(0, 0, width, height).data, width, height);
  return found?.data ?? null;
}

export interface UpiQrUploadProps {
  /** A payment QR was read. The caller fills the fields from it — and should
   *  not treat this as confirmation the account is right, only that a QR was
   *  found and read, the same caution the app's own scanner carries. */
  onScanned: (result: ScannedUpi) => void;
  className?: string;
}

/**
 * "Upload UPI QR" — the console's stand-in for the app's camera scanner,
 * wherever a UPI ID is still typed by hand (a technician's payout account,
 * the platform's own recharge account). There is no camera to point on a
 * desktop, only a file a manager already has — a screenshot forwarded on
 * WhatsApp, or a photo of a bank's printed code.
 *
 * Decoding is entirely client-side (`jsQR` over a canvas), mirroring the
 * app's own `scanFromURLAsync` path
 * (`mobileapp/src/features/payout/components/UpiScanner.tsx`): nothing picked
 * here is ever uploaded anywhere, because it is not a photo being kept, only
 * an address being read off one.
 */
export function UpiQrUpload({ onScanned, className }: UpiQrUploadProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFiles = useCallback(
    async ([picked]: PickedImage[]) => {
      setBusy(true);
      setError(null);
      try {
        const payload = await decode(picked);
        const result = payload ? parseUpiQr(payload) : null;
        if (!result) {
          setError("That's not a UPI payment QR. Try another image.");
          return;
        }
        onScanned(result);
      } catch {
        setError("Couldn't read that image. Try another.");
      } finally {
        URL.revokeObjectURL(picked.url);
        setBusy(false);
      }
    },
    [onScanned]
  );

  const picker = useImagePicker({ onFiles });
  const problem = picker.error ?? error;

  return (
    <div className={className}>
      <input {...picker.inputProps} />
      <Button type="button" variant="outline" size="sm" onClick={picker.open} disabled={busy}>
        {busy ? <Spinner data-icon="inline-start" /> : <QrCode data-icon="inline-start" />}
        Upload UPI QR
      </Button>
      {problem ? (
        <p role="alert" className="mt-1.5 text-xs font-medium text-danger">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
