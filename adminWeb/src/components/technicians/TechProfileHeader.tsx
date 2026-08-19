import { Card, CardContent } from "@/components/ui/card";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { formatPhone } from "@/utils/phone";
import type { Technician } from "@/types/technician";
import { BandwidthBar, CancelCount, TechStatusPill } from "./BandwidthBar";

/* ------------------------------------------------------------------ identity */

export function TechProfileHeader({ tech }: { tech: Technician }) {
  const facts: Array<[string, React.ReactNode]> = [
    ["Phone", formatPhone(tech.phone)],
    ["Region", tech.regionName],
    [
      "Joined",
      new Date(tech.createdAt).toLocaleDateString("en-IN", {
        month: "short",
        year: "numeric",
      }),
    ],
    [
      "Rating",
      // A technician with no closed jobs has no rating — showing 0 would read
      // as the worst possible score rather than "not yet known".
      tech.rating === null ? (
        "—"
      ) : (
        <>
          {tech.rating}{" "}
          <span className="text-warn" aria-hidden>
            ★
          </span>
        </>
      ),
    ],
  ];

  return (
    <Card className="h-fit [--card-spacing:--spacing(5.5)]">
      <CardContent>
        <div className="flex flex-col items-center text-center">
          <UserAvatar
            name={tech.name}
            src={tech.profileImageUrl ?? undefined}
            className="size-18 text-[26px]"
          />
          <h2 className="mt-3 text-[17px] font-semibold">{tech.name}</h2>
          <p className="font-mono text-xs text-ink-3">{tech.code}</p>
          <div className="mt-2">
            <TechStatusPill status={tech.status} />
          </div>
        </div>

        <dl className="mt-4.5 divide-y divide-line-2 overflow-hidden rounded-md border border-line-2">
          {facts.map(([label, value]) => (
            <div
              key={label}
              className="flex items-center justify-between px-3.5 py-2.75"
            >
              <dt className="text-xs text-ink-3">{label}</dt>
              <dd className="text-xs font-medium">{value}</dd>
            </div>
          ))}
        </dl>

        <section className="mt-4">
          <h3 className="mb-2 text-[11px] font-bold tracking-[0.04em] text-ink-3 uppercase">
            Categories
          </h3>
          <ul className="flex flex-wrap gap-1.5">
            {tech.subcategories.map((c) => (
              <li
                key={c.id}
                className="rounded-full bg-surface-3 px-2.5 py-1 text-xs font-medium text-ink-2"
                title={`${c.categoryName} · ${c.name}`}
              >
                {c.name}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-4">
          <h3 className="mb-2 text-[11px] font-bold tracking-[0.04em] text-ink-3 uppercase">
            Service pincodes
          </h3>
          <p className="font-mono text-xs text-ink-2">{tech.pincodes.join(", ")}</p>
        </section>
      </CardContent>
    </Card>
  );
}

/* --------------------------------------------------------------------- stats */

/**
 * The four numbers an ASM reads first. Cancels is the judgement call: a high
 * count is a risk signal, since every cancellation costs a banded penalty and,
 * close to the slot, escalates.
 *
 * On-time percentage stands where the net ledger used to. The ledger is real
 * money and belongs to the ledger slice; reading it off the technician record
 * would have meant keeping the same rupees in two places.
 */
export function TechStats({ tech }: { tech: Technician }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatTile label="Jobs done">
        <span className="tabular-nums">{tech.jobsCompleted ?? "—"}</span>
      </StatTile>

      <StatTile label="Bandwidth">
        <span className="tabular-nums">
          {tech.bwUsed}/{tech.dailyJobCap}
        </span>
        <BandwidthBar
          used={tech.bwUsed}
          total={tech.dailyJobCap}
          showValue={false}
          className="mt-2"
          trackClassName="w-full"
        />
      </StatTile>

      <StatTile label="Cancels">
        {tech.jobsCancelled === null ? (
          <span className="tabular-nums">—</span>
        ) : (
          <CancelCount cancels={tech.jobsCancelled} />
        )}
      </StatTile>

      <StatTile label="On time">
        <span className="tabular-nums">
          {tech.onTimePct === null ? "—" : `${tech.onTimePct}%`}
        </span>
      </StatTile>
    </div>
  );
}

function StatTile({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent>
        <div className="text-[11px] font-semibold text-ink-3">{label}</div>
        <div className="mt-1 text-[22px] leading-tight font-semibold">
          {children}
        </div>
      </CardContent>
    </Card>
  );
}
