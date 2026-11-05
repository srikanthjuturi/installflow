import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { MapPinOff, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/DataTable";
import type { Column, TypedFilterDef } from "@/components/shared/DataTable";
import { PageMeta } from "@/components/shared/PageMeta";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ErrorState } from "@/components/shared/states";
import { ticketPathFor } from "@/components/transactions/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompanyOptions } from "@/hooks/useTransactions";
import { useAllLiveLocations, useLiveLocations } from "@/hooks/useLiveLocation";
import {
  accuracyText,
  distanceToCustomer,
  freshnessText,
  placeText,
  summaryCounts,
} from "@/lib/liveLocation";
import { cn } from "@/lib/utils";
import type { LiveLocation } from "@/types/liveLocation";
import type { TransactionSurface } from "@/types/transaction";

/* Leaflet is its own chunk - only this page and the ticket card load it. */
const LiveMap = lazy(() => import("@/components/geo/LiveMap"));

const ALL = "All";

/**
 * Live technicians (Epic 4): one map with every pin beside a list of the same
 * rows. One component for all four surfaces; the SERVER decides which
 * technicians the caller may see, so this only renders (the superadmin alone
 * may narrow by company).
 *
 * Only each technician's latest point exists. A stale one is greyed and says
 * its phone is not reporting - never that they are at that place.
 */
export function LiveTechniciansView({
  surface,
}: {
  surface: TransactionSurface;
}) {
  const isSuperadmin = surface === "superadmin";
  const [companyId, setCompanyId] = useState<string | null>(null);
  const companies = useCompanyOptions(isSuperadmin);
  // The technician the map is zoomed to (keyed by ticket, like the pins), and
  // whether the map fills the screen.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const mapBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [fullscreen]);

  const pick = (id: string) => {
    setSelectedId(id);
    if (!fullscreen) {
      mapBox.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  const own = useLiveLocations(!isSuperadmin);
  const all = useAllLiveLocations(companyId, isSuperadmin);
  const q = isSuperadmin ? all : own;
  const rows = q.data;

  const companyName = useMemo(
    () => new Map((companies.data ?? []).map((c) => [c.id, c.name])),
    [companies.data]
  );

  const pins = useMemo(
    () =>
      (rows ?? []).map((l) => {
        const acc = accuracyText(l.accuracyM);
        const away = distanceToCustomer(l);
        const to = ticketPathFor(surface, l.ticketId);
        return {
          id: l.ticketId,
          lat: l.latitude,
          lng: l.longitude,
          stale: l.stale,
          accuracyM: l.accuracyM,
          label: [
            l.technicianName,
            l.ticketCode,
            freshnessText(l),
            ...(acc ? [`accuracy ${acc}`] : []),
          ],
          popup: (
            <div className="grid min-w-44 gap-1 text-[13px]">
              <div className="text-sm font-semibold">{l.technicianName}</div>
              <div>
                {to ? (
                  <Link to={to} className="font-mono text-xs underline">
                    {l.ticketCode}
                  </Link>
                ) : (
                  <span className="font-mono text-xs">{l.ticketCode}</span>
                )}
                {" · "}
                {l.status}
              </div>
              {placeText(l) !== "—" ? <div>{placeText(l)}</div> : null}
              <div className={cn(l.stale && "font-medium text-warn")}>
                {freshnessText(l)}
              </div>
              {acc ? <div>Accuracy {acc}</div> : null}
              {away ? <div>{away} from the customer</div> : null}
            </div>
          ),
        };
      }),
    [rows, surface]
  );

  const columns: Column<LiveLocation>[] = [
    {
      id: "technician",
      header: "Technician",
      cell: (l) => <span className="font-medium">{l.technicianName}</span>,
      sortValue: (l) => l.technicianName.toLowerCase(),
    },
    {
      id: "ticket",
      header: "Ticket",
      cellClassName: "font-mono text-xs whitespace-nowrap",
      cell: (l) => {
        const to = ticketPathFor(surface, l.ticketId);
        return to ? (
          <Link
            to={to}
            className="text-brand-600 underline-offset-2 hover:underline"
          >
            {l.ticketCode}
          </Link>
        ) : (
          l.ticketCode
        );
      },
      sortValue: (l) => l.ticketCode,
    },
    ...(isSuperadmin
      ? [
          {
            id: "company",
            header: "Company",
            cell: (l: LiveLocation) => companyName.get(l.companyId) ?? "—",
          } satisfies Column<LiveLocation>,
        ]
      : []),
    {
      id: "status",
      header: "Status",
      cell: (l) => <StatusBadge status={l.status} />,
    },
    {
      id: "place",
      header: "City / pincode",
      cell: (l) => placeText(l),
    },
    {
      id: "seen",
      header: "Last seen",
      cellClassName: "whitespace-nowrap",
      cell: (l) => (
        <span className={cn(l.stale && "font-medium text-warn")}>
          {freshnessText(l)}
        </span>
      ),
      sortValue: (l) => l.ageSeconds,
    },
  ];

  const filters: Array<TypedFilterDef<LiveLocation>> = isSuperadmin
    ? [
        {
          id: "company",
          label: "Company",
          variant: "select",
          allValue: ALL,
          options: [
            ...(companies.data ?? []).map((c) => ({ value: c.id, label: c.name })),
            { value: ALL, label: "All" },
          ],
          value: companyId ?? ALL,
          onChange: (v: string) => setCompanyId(v === ALL ? null : v),
        },
      ]
    : [];

  const { live, stale } = summaryCounts(rows ?? []);

  return (
    <>
      <PageMeta
        title="Live technicians"
        description="Technicians out on a job right now."
      />

      <p className="mb-4 max-w-2xl text-[13px] text-ink-2">
        Technicians out on a job right now, from the app while it is open on
        their phone. Only the latest position is shown — a grey pin means their
        phone is not reporting.
      </p>

      <div className="grid gap-3.5">
        {q.isError ? null : (
          <div
            ref={mapBox}
            className={cn(
              "bg-surface",
              fullscreen
                ? "fixed inset-0 z-50 flex flex-col"
                : "overflow-hidden rounded-lg border"
            )}
          >
            {fullscreen ? (
              <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
                <div>
                  <h2 className="text-sm font-semibold">Live technicians</h2>
                  {rows ? (
                    <p className="text-xs text-ink-2">
                      {live} reporting · {stale} not reporting
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setFullscreen(false)}
                >
                  <Minimize2 data-icon="inline-start" aria-hidden />
                  Exit full screen
                </Button>
              </div>
            ) : null}
            <div className={cn("flex", fullscreen ? "min-h-0 flex-1" : "h-96")}>
              {fullscreen ? (
                <aside
                  aria-label="Technicians"
                  className="w-72 shrink-0 overflow-auto border-r"
                >
                  {(rows ?? []).length === 0 ? (
                    <p className="p-4 text-sm text-ink-3">
                      Nobody is sharing their location.
                    </p>
                  ) : (
                    <ul>
                      {(rows ?? []).map((l) => (
                        <li key={l.ticketId}>
                          <button
                            type="button"
                            onClick={() => pick(l.ticketId)}
                            aria-pressed={selectedId === l.ticketId}
                            className={cn(
                              "grid w-full gap-0.5 border-b px-4 py-2.5 text-left hover:bg-surface-2",
                              selectedId === l.ticketId && "bg-info-bg",
                              l.stale && "opacity-60"
                            )}
                          >
                            <span className="text-sm font-medium">
                              {l.technicianName}
                            </span>
                            <span className="font-mono text-xs text-ink-2">
                              {l.ticketCode}
                            </span>
                            <span
                              className={cn(
                                "text-xs text-ink-3",
                                l.stale && "text-warn"
                              )}
                            >
                              {freshnessText(l)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </aside>
              ) : null}
              <div className="relative min-w-0 flex-1">
                {q.isLoading ? (
                  <Skeleton className="h-full w-full rounded-none" />
                ) : (
                  <Suspense
                    fallback={<Skeleton className="h-full w-full rounded-none" />}
                  >
                    <LiveMap
                      pins={pins}
                      className="h-full w-full"
                      selectedId={selectedId}
                      onSelect={setSelectedId}
                    />
                  </Suspense>
                )}
                {fullscreen ? null : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="absolute top-2.5 right-2.5 z-[1000] bg-surface"
                    onClick={() => setFullscreen(true)}
                  >
                    <Maximize2 data-icon="inline-start" aria-hidden />
                    Full screen
                  </Button>
                )}
              </div>
            </div>
            {rows && !fullscreen ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1 border-t px-3.5 py-2 text-xs text-ink-2">
                <span>{live} reporting</span>
                <span className={cn(stale > 0 && "text-warn")}>
                  {stale} not reporting
                </span>
              </div>
            ) : null}
          </div>
        )}

        {q.isError ? (
          <ErrorState
            title="Couldn't load live technicians"
            error={q.error}
            onRetry={() => void q.refetch()}
          />
        ) : (
          <DataTable
            caption="Technicians out on a job with their ticket, status, place and when they were last heard from"
            data={rows}
            columns={columns}
            getRowId={(l) => l.ticketId}
            isLoading={q.isLoading}
            isFetching={q.isFetching && !q.isLoading}
            error={q.error}
            onRetry={() => void q.refetch()}
            errorTitle="Couldn't load live technicians"
            search={{
              placeholder: "Search technician or ticket",
              fn: (l, text) => {
                const t = text.trim().toLowerCase();
                return (
                  l.technicianName.toLowerCase().includes(t) ||
                  l.ticketCode.toLowerCase().includes(t)
                );
              },
            }}
            filters={filters}
            defaultSort={{ columnId: "seen", dir: "asc" }}
            onRowClick={(l) => pick(l.ticketId)}
            rowClassName={(l) =>
              cn(l.stale && "opacity-60", selectedId === l.ticketId && "bg-info-bg")
            }
            pagination={{ defaultSize: 25 }}
            minWidth="720px"
            emptyIcon={MapPinOff}
            emptyTitle="No technicians are sharing their location"
            emptyDescription="Nobody is out on a job right now, or their phones are not sharing."
            countLabel={(n) => `${n} ${n === 1 ? "technician" : "technicians"}`}
          />
        )}
      </div>
    </>
  );
}
