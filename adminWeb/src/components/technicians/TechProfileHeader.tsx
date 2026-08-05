import { Card, CardContent } from "@/components/ui/card";
import { money } from "@/utils/money";
import type { Technician } from "@/types";
import {
  BandwidthBar,
  CancelCount,
  TechAvatar,
  TechStatusPill,
} from "./BandwidthBar";

/* ------------------------------------------------------------------ identity */

export function TechProfileHeader({ tech }: { tech: Technician }) {
  const facts: Array<[string, React.ReactNode]> = [
    ["Phone", tech.phone],
    ["Joined", tech.joined],
    [
      "Rating",
      <>
        {tech.rating}{" "}
        <span className="text-warn" aria-hidden>
          ★
        </span>
      </>,
    ],
  ];

  return (
    <Card className="h-fit [--card-spacing:--spacing(5.5)]">
      <CardContent>
        <div className="flex flex-col items-center text-center">
          <TechAvatar name={tech.name} size="lg" />
          <h2 className="mt-3 text-[17px] font-semibold">{tech.name}</h2>
          <p className="font-mono text-xs text-ink-3">{tech.id}</p>
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
            {tech.cats.map((c) => (
              <li
                key={c}
                className="rounded-full bg-surface-3 px-2.5 py-1 text-xs font-medium text-ink-2"
              >
                {c}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-4">
          <h3 className="mb-2 text-[11px] font-bold tracking-[0.04em] text-ink-3 uppercase">
            Service pincodes
          </h3>
          <p className="font-mono text-xs text-ink-2">{tech.pincodes}</p>
        </section>
      </CardContent>
    </Card>
  );
}

/* --------------------------------------------------------------------- stats */

/**
 * The four numbers an ASM reads first. Cancels and the net ledger are the
 * judgement calls: a high cancel count is a risk signal, and the net ledger
 * is bonuses earned minus penalties charged — negative means this technician
 * has cost the pool more than they have earned from it.
 */
export function TechStats({ tech }: { tech: Technician }) {
  const net = tech.bonus - tech.penalty;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatTile label="Jobs done">
        <span className="tabular-nums">{tech.jobs}</span>
      </StatTile>

      <StatTile label="Bandwidth">
        <span className="tabular-nums">
          {tech.bwUsed}/{tech.bwTotal}
        </span>
        <BandwidthBar
          used={tech.bwUsed}
          total={tech.bwTotal}
          showValue={false}
          className="mt-2"
          trackClassName="w-full"
        />
      </StatTile>

      <StatTile label="Cancels">
        <CancelCount cancels={tech.cancels} />
      </StatTile>

      {/* money() writes debits with a real minus sign, so the sign — not the
          tint — is what tells you the ledger is negative. */}
      <StatTile label="Net ledger">
        <span className={net < 0 ? "text-danger" : "text-ok"}>
          {money(net)}
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
