import { useMemo } from "react";
import { Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  HeadTr,
  Table,
  TableBody,
  TableHeader,
  Td,
  Th,
  Tr,
} from "@/components/shared/DataTable";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { useAutoSelectSingle } from "@/hooks/useAutoSelectSingle";
import type {
  TransactionPatch,
  TransactionUrlState,
} from "@/hooks/useTransactionFilters";
import {
  useDownloadStatementCsv,
  useStatement,
  useTransactionParties,
} from "@/hooks/useTransactions";
import { cn } from "@/lib/utils";
import { statementFileName } from "@/services/transactions";
import {
  DOC_TYPE_LABELS,
  PARTY_KINDS,
  PARTY_KIND_LABELS,
  SURFACE_CAPS,
  balanceWording,
  type PartyKind,
  type Statement,
  type TransactionSurface,
} from "@/types/transaction";
import { saveBlob } from "@/utils/download";
import { NEEDS_NO_PARTY, resolveStatementQuery } from "./statementQuery";
import { formatDate } from "@/utils/datetime";
import { moneyPaise } from "@/utils/money";

/**
 * The Statement tab: an account for one party over the chosen period - opening
 * balance, every document with a running balance, totals and the closing
 * balance in plain words ("owes the company" / "is owed by the company" /
 * "settled") - and a CSV download.
 *
 * Vendor and franchise surfaces have the party fixed to themselves: it is read
 * from `/transactions/parties`, which returns exactly their one party.
 */
export function StatementPanel({
  surface,
  state,
  patch,
  companies,
}: {
  surface: TransactionSurface;
  state: TransactionUrlState;
  patch: (changes: TransactionPatch) => void;
  companies?: { id: string; name: string }[];
}) {
  const caps = SURFACE_CAPS[surface];
  const kind = caps.fixedKind ?? state.statementKind;

  // Who has documents - the party picker (and, for a fixed-party surface, the
  // caller's own id). A superadmin must pick the company first.
  const wantsParties = kind !== undefined && kind !== NEEDS_NO_PARTY;
  const parties = useTransactionParties({
    companyId: caps.companyFilter ? state.companyId : undefined,
    partyKind: kind,
    enabled: wantsParties && (!caps.companyFilter || Boolean(state.companyId)),
  });
  const partyList = useMemo(
    () => (parties.data ?? []).filter((p) => p.partyId !== null),
    [parties.data]
  );
  const ownPartyId = caps.fixedParty ? (partyList[0]?.partyId ?? null) : null;

  // One party to pick from: pick it (hard rule 10).
  useAutoSelectSingle(
    partyList.map((p) => p.partyId as string),
    state.statementParty ?? "",
    (id) => patch({ sp: id }),
    !caps.fixedParty && wantsParties && !parties.isLoading
  );

  const { query, missing } = resolveStatementQuery({ surface, state, ownPartyId });
  // A fixed-party surface that has no documents has no party to ask for.
  const noOwnParty =
    caps.fixedParty && wantsParties && !parties.isLoading && partyList.length === 0;
  const statement = useStatement(noOwnParty ? null : query);
  const download = useDownloadStatementCsv();

  return (
    <div className="grid gap-4">
      {!caps.fixedParty || caps.companyFilter ? (
        <Card>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              {caps.companyFilter ? (
                <div className="grid w-56 gap-1.5">
                  <Label htmlFor="st-company">Company</Label>
                  <Select
                    value={state.companyId ?? ""}
                    onValueChange={(v) => v && patch({ company: v, sp: undefined })}
                  >
                    <SelectTrigger id="st-company">
                      <SelectValue placeholder="Choose a company">
                        {(v: string) => companies?.find((c) => c.id === v)?.name ?? v}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(companies ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {!caps.fixedParty ? (
                <>
                  <div className="grid w-44 gap-1.5">
                    <Label htmlFor="st-kind">Statement for</Label>
                    <Select
                      value={state.statementKind ?? ""}
                      onValueChange={(v) => v && patch({ sk: v, sp: undefined })}
                    >
                      <SelectTrigger id="st-kind">
                        <SelectValue placeholder="Choose">
                          {(v: string) => PARTY_KIND_LABELS[v as PartyKind] ?? v}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {PARTY_KINDS.map((k) => (
                          <SelectItem key={k} value={k}>
                            {PARTY_KIND_LABELS[k]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {wantsParties ? (
                    <div className="grid w-64 gap-1.5">
                      <Label htmlFor="st-party">
                        {PARTY_KIND_LABELS[kind as PartyKind]}
                      </Label>
                      <Select
                        value={state.statementParty ?? ""}
                        onValueChange={(v) => v && patch({ sp: v })}
                        disabled={caps.companyFilter && !state.companyId}
                      >
                        <SelectTrigger id="st-party">
                          <SelectValue
                            placeholder={parties.isLoading ? "Loading…" : "Choose"}
                          >
                            {(v: string) => partyList.find((p) => p.partyId === v)?.label ?? v}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {partyList.map((p) => (
                            <SelectItem key={p.partyId} value={p.partyId as string}>
                              {p.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <StatementBody
        statement={statement.data}
        isLoading={
          (statement.isLoading && query !== null) ||
          (caps.fixedParty && wantsParties && parties.isLoading)
        }
        error={statement.error}
        onRetry={() => statement.refetch()}
        missing={noOwnParty ? null : missing}
        noDocuments={noOwnParty}
        downloading={download.isPending}
        onDownload={() => {
          if (!query || !statement.data) return;
          download.mutate(query, {
            onSuccess: (blob) =>
              saveBlob(
                blob,
                statementFileName({
                  partyLabel: statement.data?.partyLabel ?? "account",
                  from: query.from,
                  to: query.to,
                })
              ),
          });
        }}
      />
    </div>
  );
}

function StatementBody({
  statement,
  isLoading,
  error,
  onRetry,
  missing,
  noDocuments,
  downloading,
  onDownload,
}: {
  statement?: Statement;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  missing: string | null;
  noDocuments: boolean;
  downloading: boolean;
  onDownload: () => void;
}) {
  if (noDocuments) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={FileText}
            title="No statement yet"
            description="Your account has no numbered documents so far."
          />
        </CardContent>
      </Card>
    );
  }
  if (missing) {
    return (
      <Card>
        <CardContent>
          <EmptyState icon={FileText} title="Choose a statement" description={missing} />
        </CardContent>
      </Card>
    );
  }
  if (error && !statement) {
    return (
      <Card>
        <CardContent>
          <ErrorState title="Couldn't load the statement" error={error} onRetry={onRetry} />
        </CardContent>
      </Card>
    );
  }
  if (isLoading || !statement) {
    return (
      <Card>
        <CardContent className="grid gap-3">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      </Card>
    );
  }

  const closing = balanceWording(statement.closingPaise);
  return (
    <Card>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">{statement.partyLabel}</h2>
            <p className="text-[13px] text-ink-2">
              {statement.companyName} · {PARTY_KIND_LABELS[statement.partyKind]} ·{" "}
              {formatDate(statement.start)} – {formatDate(statement.end)}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={downloading}
            onClick={onDownload}
          >
            <Download data-icon="inline-start" aria-hidden />
            Download CSV
          </Button>
        </div>

        <div className="flex items-baseline justify-between rounded-lg border border-line bg-surface-2 px-3.5 py-2.5 text-[13px]">
          <span className="text-ink-2">Opening balance</span>
          <BalanceFigure paise={statement.openingPaise} />
        </div>

        {statement.lines.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No documents in this period"
            description="The balance carried forward is shown above and below."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[48rem]">
              <caption className="sr-only">
                Documents in the period with a running balance
              </caption>
              <TableHeader>
                <HeadTr>
                  <Th>Date</Th>
                  <Th>Number</Th>
                  <Th>Details</Th>
                  <Th className="text-right">Debit</Th>
                  <Th className="text-right">Credit</Th>
                  <Th className="text-right">Balance</Th>
                </HeadTr>
              </TableHeader>
              <TableBody>
                {statement.lines.map((l) => (
                  <Tr key={l.documentId}>
                    <Td className="whitespace-nowrap">{formatDate(l.issuedAt)}</Td>
                    <Td className="font-mono text-xs whitespace-nowrap">{l.number}</Td>
                    <Td>
                      <div className="leading-tight">
                        <div>{l.description}</div>
                        <div className="text-xs text-ink-3">
                          {DOC_TYPE_LABELS[l.docType]}
                          {l.reference ? ` · ${l.reference}` : ""}
                        </div>
                      </div>
                    </Td>
                    <Td className="text-right tabular-nums">
                      {l.debitPaise ? moneyPaise(l.debitPaise) : "—"}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {l.creditPaise ? moneyPaise(l.creditPaise) : "—"}
                    </Td>
                    <Td className="text-right font-semibold tabular-nums">
                      {moneyPaise(l.balancePaise)}
                    </Td>
                  </Tr>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <dl className="grid gap-1.5 text-[13px] sm:ml-auto sm:w-80">
          <div className="flex justify-between">
            <dt className="text-ink-2">Total debits</dt>
            <dd className="tabular-nums">{moneyPaise(statement.totalDebitPaise)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-2">Total credits</dt>
            <dd className="tabular-nums">{moneyPaise(statement.totalCreditPaise)}</dd>
          </div>
          <div className="flex justify-between border-t border-line pt-1.5 text-sm font-semibold">
            <dt>Closing balance</dt>
            <dd className="tabular-nums">{moneyPaise(statement.closingPaise)}</dd>
          </div>
        </dl>

        <p
          className={cn(
            "rounded-lg px-3.5 py-2.5 text-[13px] font-medium",
            closing.tone === "owes" && "bg-warn-bg text-warn",
            closing.tone === "owed" && "bg-info-bg text-info",
            closing.tone === "settled" && "bg-ok-bg text-ok"
          )}
        >
          {closing.tone === "settled"
            ? `${statement.partyLabel}'s account is settled.`
            : `${statement.partyLabel} ${closing.phrase}: ${moneyPaise(Math.abs(statement.closingPaise))}.`}
        </p>
      </CardContent>
    </Card>
  );
}

function BalanceFigure({ paise }: { paise: number }) {
  const w = balanceWording(paise);
  return (
    <span className="font-semibold tabular-nums">
      {moneyPaise(paise)}
      <span className="ml-2 text-xs font-normal text-ink-3">
        {w.tone === "settled" ? "settled" : w.phrase}
      </span>
    </span>
  );
}
