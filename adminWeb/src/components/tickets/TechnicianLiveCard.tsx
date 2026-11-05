import { lazy, Suspense } from "react";
import { MapPinOff, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Notice } from "@/components/shared/Notice";
import { useTicketLiveLocation } from "@/hooks/useLiveLocation";
import {
  accuracyText,
  distanceToCustomer,
  freshnessText,
  isLiveStatus,
} from "@/lib/liveLocation";
import { cn } from "@/lib/utils";
import type { LiveLocation } from "@/types/liveLocation";

/* Leaflet is its own chunk, as in BaseLocationDialog: nobody whose ticket has
   no live technician pays for it. */
const LiveMap = lazy(() => import("@/components/geo/LiveMap"));

/**
 * "Live location" on the ticket page - company console, vendor portal and the
 * franchise portal's read-only copy all render this one card.
 *
 * Nothing renders unless the ticket is Assigned / In Progress / Awaiting Part:
 * location is shared only while the technician holds an active job. The card
 * shows the technician's NAME only - never a phone number.
 */
export function TechnicianLiveCard({
  ticketId,
  status,
}: {
  ticketId: string;
  status: string;
}) {
  if (!isLiveStatus(status)) return null;
  return <LiveCardBody ticketId={ticketId} />;
}

function LiveCardBody({ ticketId }: { ticketId: string }) {
  const { data, isLoading, isError, refetch, isFetching } =
    useTicketLiveLocation(ticketId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Live location</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid gap-2.5" aria-busy="true">
            <Skeleton className="h-60 rounded-md" />
            <Skeleton className="h-4 w-40" />
          </div>
        ) : isError ? (
          <div className="grid gap-2.5">
            <Notice tone="warn" icon={MapPinOff} title="Couldn't load the location">
              Try again in a moment.
            </Notice>
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              <RotateCw data-icon="inline-start" aria-hidden />
              Retry
            </Button>
          </div>
        ) : data ? (
          <LiveBody location={data} />
        ) : (
          <div className="flex items-start gap-2.5 text-[13px] text-ink-2">
            <MapPinOff className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
            <p>
              Location isn&apos;t available — the job isn&apos;t active, or the
              technician&apos;s phone isn&apos;t sharing right now.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LiveBody({ location: l }: { location: LiveLocation }) {
  const distance = distanceToCustomer(l);
  const accuracy = accuracyText(l.accuracyM);
  const customer =
    l.customerLatitude !== null && l.customerLongitude !== null
      ? { lat: l.customerLatitude, lng: l.customerLongitude }
      : null;

  return (
    <div className="grid gap-2.5">
      <div className={cn("overflow-hidden rounded-md", l.stale && "grayscale")}>
        <Suspense fallback={<Skeleton className="h-60 rounded-md" />}>
          <LiveMap
            className="h-60 w-full"
            pins={[
              {
                id: l.technicianId,
                lat: l.latitude,
                lng: l.longitude,
                stale: l.stale,
                accuracyM: l.accuracyM,
                label: [l.technicianName, freshnessText(l)],
              },
            ]}
            customer={customer}
          />
        </Suspense>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-[13px] font-semibold">{l.technicianName}</span>
        {distance ? (
          <span className="text-xs text-ink-2">
            {distance} from the customer (straight line)
          </span>
        ) : null}
      </div>

      <p
        className={cn(
          "text-xs",
          l.stale ? "font-medium text-warn" : "text-ink-3"
        )}
        role={l.stale ? "status" : undefined}
      >
        {freshnessText(l)}
        {!l.stale && accuracy ? ` · accuracy ${accuracy}` : null}
      </p>
    </div>
  );
}
