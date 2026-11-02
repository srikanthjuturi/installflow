import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import type { DeliveryAddress } from "@/types/parts";
import { formatPhone } from "@/utils/phone";
import {
  deliveryLines,
  deliverySourceLabel,
  deliverySourceNote,
  formatDeliveryAddress,
} from "./deliveryAddress";

/** Clipboard write with a hidden-textarea fallback for non-secure origins. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.className = "fixed -top-96 left-0 opacity-0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * Where the parcel goes — the technician's parts address, copied onto the
 * request when they raised it (Epic 6). No customer data is involved.
 */
export function DeliverTo({
  address,
}: {
  address: DeliveryAddress | null | undefined;
}) {
  const onCopy = async () => {
    if (!address) return;
    const ok = await copyText(formatDeliveryAddress(address));
    toast.add(
      ok
        ? { title: "Address copied" }
        : { title: "Couldn't copy the address" }
    );
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="text-sm">Deliver to</CardTitle>
        {address ? (
          <Button type="button" variant="outline" size="sm" onClick={onCopy}>
            <Copy data-icon="inline-start" aria-hidden />
            Copy
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {address ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] font-semibold tracking-[0.04em] text-ink-3 uppercase">
              {deliverySourceLabel(address)}
            </p>
            <address className="text-[13px] font-medium not-italic wrap-anywhere">
              {deliveryLines(address).map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </address>
            {address.contactPhone ? (
              <a
                href={`tel:${address.contactPhone}`}
                className="text-[13px] text-brand-400"
              >
                {formatPhone(address.contactPhone)}
              </a>
            ) : null}
            {deliverySourceNote(address) ? (
              <p className="mt-1 text-xs text-ink-3">
                {deliverySourceNote(address)}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-[13px] text-ink-3">No delivery address on file</p>
        )}
      </CardContent>
    </Card>
  );
}
