import { ExternalLink } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  formatCount,
  previewSummary,
} from "@/components/franchisees/pincodeRanges";
import type { PincodeChange } from "@/types/franchisee";

/**
 * What a pincode plan would do, before it is applied.
 *
 * The server computed all of it — every number here is read out of the
 * `PincodeChange`, never derived. The small tables deliberately share the shape
 * of `shared/RejectsTable.tsx` (capped list, true total, mono codes) rather than
 * the component itself: that one hardcodes "rejected" as its meaning and a CSV
 * download, and neither belongs to a preview.
 *
 * Colour never carries the meaning alone (adminWeb hard rule): the clash table
 * says WHY it blocks in its heading, and the warn tint only backs the words.
 */
export function CarveOutPreview({
  change,
  homeName,
  loading = false,
}: {
  change: PincodeChange;
  /** The home franchisee's name, for the removal copy ("handed back to …"). */
  homeName: string;
  /** While the FIRST preview is still in flight — skeleton rows, never a spinner. */
  loading?: boolean;
}) {
  return (
    <div className="grid gap-4">
      <Summary change={change} homeName={homeName} />
      {loading ? <PreviewSkeleton /> : <Impact change={change} homeName={homeName} />}
    </div>
  );
}

function Summary({ change, homeName }: { change: PincodeChange; homeName: string }) {
  return (
    <ul className="grid gap-1 text-[13px]">
      {previewSummary(change, homeName).map((line) => (
        <li key={line} className="text-ink-2">
          {line}
        </li>
      ))}
    </ul>
  );
}

/* ── impact tables ──────────────────────────────────────────────────────────
   A moved technician goes to exactly one franchisee: INTO the edited one
   (their from-name is somebody else's) or OUT of it to the home (their
   from-name is this franchisee). The two reads have different copy, so they
   render as two groups — a reader who is handing pincodes back should never
   have to decode "move here" as meaning someone just lost theirs. */

function Impact({ change, homeName }: { change: PincodeChange; homeName: string }) {
  const leaving = change.movedTechnicians.filter(
    (t) => t.fromFranchiseeId === change.franchiseeId
  );
  const arriving = change.movedTechnicians.filter(
    (t) => t.fromFranchiseeId !== change.franchiseeId
  );

  return (
    <>
      {change.clashCount > 0 ? <Clashes change={change} /> : null}
      {arriving.length > 0 ? (
        <MiniTable
          title="Technicians who move here"
          note="All of their pincodes are inside this franchisee."
          columns={["Technician", "From", "Pincodes"]}
          rows={arriving}
          keyOf={(t) => t.id}
          cells={(t) => [techCell(t), t.fromFranchiseeName, formatCount(t.pincodeCount, "pincode", "pincodes")]}
        />
      ) : null}
      {leaving.length > 0 ? (
        <MiniTable
          title={`Technicians who move to ${homeName}`}
          note="All of their pincodes are being handed back."
          columns={["Technician", "From", "Pincodes"]}
          rows={leaving}
          keyOf={(t) => t.id}
          cells={(t) => [techCell(t), t.fromFranchiseeName, formatCount(t.pincodeCount, "pincode", "pincodes")]}
        />
      ) : null}
      {change.trimmedTechnicians.length > 0 ? (
        <MiniTable
          title="Technicians who lose pincodes"
          note="Some of their pincodes change hands; they keep the rest."
          columns={["Technician", "From", "Losing", "Keeping"]}
          rows={change.trimmedTechnicians}
          keyOf={(t) => t.id}
          cells={(t) => [
            techCell(t),
            t.fromFranchiseeName,
            t.losing.join(", "),
            formatCount(t.keepingCount, "pincode", "pincodes"),
          ]}
          monoColumns={["Losing"]}
        />
      ) : null}
      {change.restampedTickets.count > 0 ? (
        <RestampedTickets change={change} />
      ) : null}
    </>
  );
}

/** "Ravi Kumar" when they gave one; the code is on every row either way. */
function techCell(t: { code: string; name: string | null }): string {
  return t.name ? `${t.name} · ${t.code}` : t.code;
}

/* ── one small table, shared by every impact section ─────────────────────── */

function MiniTable<T>({
  title,
  note,
  columns,
  rows,
  keyOf,
  cells,
  monoColumns,
  tone = "body",
  footer,
}: {
  title: string;
  note?: string;
  columns: string[];
  rows: T[];
  /** The rows on screen are a cap; `footer` names the true total when so. */
  keyOf: (row: T, index: number) => string;
  cells: (row: T) => string[];
  /** Which columns read as codes somebody compares — rendered mono. */
  monoColumns?: string[];
  tone?: "body" | "warn";
  footer?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border border-line",
        tone === "warn" ? "bg-warn-bg/40" : "bg-surface-1"
      )}
    >
      <div className="border-b border-line px-3 py-2">
        <p className="text-[13px] font-medium text-ink">{title}</p>
        {note ? <p className="text-[12px] text-ink-3">{note}</p> : null}
      </div>
      <div className="scroll-none max-h-44 overflow-y-auto">
        <table className="w-full text-[12px]">
          <thead className="bg-surface-2 text-ink-3">
            <tr>
              {columns.map((c) => (
                <th
                  key={c}
                  scope="col"
                  className="px-3 py-1.5 text-left font-medium"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={keyOf(row, i)}
                className={cn(tone === "warn" && "bg-surface-2/60")}
              >
                {cells(row).map((value, j) => (
                  <td
                    key={columns[j]}
                    className={cn(
                      "px-3 py-1.5 align-top",
                      tone === "body" && "text-ink-2",
                      monoColumns?.includes(columns[j]) &&
                        "font-mono text-ink"
                    )}
                  >
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer ? (
        <p className="border-t border-line px-3 py-1.5 text-[11px] text-ink-3">
          {footer}
        </p>
      ) : null}
    </section>
  );
}

function Clashes({ change }: { change: PincodeChange }) {
  return (
    <MiniTable
      title="Already owned by another franchisee"
      note="Remove these — a pincode belongs to one franchisee only."
      columns={["Pincode", "Owned by"]}
      rows={change.clashes}
      keyOf={(c) => c.pincode}
      cells={(c) => [c.pincode, c.franchiseeName]}
      monoColumns={["Pincode"]}
      tone="warn"
      footer={
        change.clashCount > change.clashes.length
          ? `+${(change.clashCount - change.clashes.length).toLocaleString()} more not shown`
          : undefined
      }
    />
  );
}

function RestampedTickets({ change }: { change: PincodeChange }) {
  const n = change.restampedTickets.count;
  return (
    <section className="rounded-lg border border-line bg-surface-1">
      <div className="border-b border-line px-3 py-2">
        <p className="text-[13px] font-medium text-ink">Tickets re-stamped</p>
        <p className="text-[12px] text-ink-3">
          Open tickets nobody has taken yet move with their pincode. Jobs a
          technician already holds keep their technician.
        </p>
      </div>
      <p className="px-3 py-2 text-[13px] text-ink-2">
        {formatCount(n, "ticket", "tickets")}
      </p>
      {change.restampedTickets.sample.length > 0 ? (
        <div className="scroll-none max-h-44 overflow-y-auto pb-2">
          <table className="w-full text-[12px]">
            <thead className="bg-surface-2 text-ink-3">
              <tr>
                <th scope="col" className="px-3 py-1.5 text-left font-medium">
                  Ticket
                </th>
                <th scope="col" className="px-3 py-1.5 text-left font-medium">
                  Pincode
                </th>
                <th scope="col" className="px-3 py-1.5 text-left font-medium">
                  Was with
                </th>
              </tr>
            </thead>
            <tbody>
              {change.restampedTickets.sample.map((t) => (
                <tr key={t.id}>
                  <td className="px-3 py-1.5 font-mono text-ink">
                    <a
                      href={`/tickets/${t.id}`}
                      target="_blank"
                      // A new tab, never a nav away — the dialog is holding an
                      // unapplied plan.
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 underline hover:text-brand-600"
                    >
                      {t.code}
                      <ExternalLink className="size-3" aria-hidden />
                    </a>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-ink">{t.pincode}</td>
                  <td className="px-3 py-1.5 text-ink-2">
                    {t.fromFranchiseeName}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

/** Skeleton rows for the FIRST preview — same rhythm as the impact sections. */
function PreviewSkeleton() {
  return (
    <>
      {[0, 1].map((i) => (
        <div key={i} className="rounded-lg border border-line">
          <div className="border-b border-line px-3 py-2">
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="grid gap-2 p-3">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-3.5 w-2/3" />
          </div>
        </div>
      ))}
    </>
  );
}