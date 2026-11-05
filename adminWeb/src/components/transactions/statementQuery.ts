import { rangeProblem } from "@/lib/transactionPeriod";
import type { TransactionUrlState } from "@/hooks/useTransactionFilters";
import type { StatementQuery } from "@/services/transactions";
import {
  PARTY_KIND_LABELS,
  SURFACE_CAPS,
  type PartyKind,
  type TransactionSurface,
} from "@/types/transaction";

/** A party kind whose statement needs no party id. */
export const NEEDS_NO_PARTY: PartyKind = "platform";

/**
 * Picks what a statement is about, from the surface and the URL. Pure enough
 * to reason about: returns the query to send, or the sentence saying what is
 * still missing. Exported for the tests.
 */
export function resolveStatementQuery(input: {
  surface: TransactionSurface;
  state: Pick<
    TransactionUrlState,
    "range" | "companyId" | "statementKind" | "statementParty"
  >;
  /** The caller's own party, from `/transactions/parties`, for a fixed-party surface. */
  ownPartyId?: string | null;
}): { query: StatementQuery | null; missing: string | null } {
  const caps = SURFACE_CAPS[input.surface];
  const { range } = input.state;
  const problem = rangeProblem(range);
  if (problem) return { query: null, missing: problem };

  const kind = caps.fixedKind ?? input.state.statementKind;
  if (!kind) return { query: null, missing: "Choose who the statement is for." };

  // The server answers 422 COMPANY_REQUIRED without one; do not ask.
  if (caps.companyFilter && !input.state.companyId) {
    return { query: null, missing: "Choose a company." };
  }
  const base = {
    partyKind: kind,
    from: range.from,
    to: range.to,
    ...(caps.companyFilter && input.state.companyId
      ? { companyId: input.state.companyId }
      : {}),
  };
  if (kind === NEEDS_NO_PARTY) return { query: { ...base, partyId: null }, missing: null };

  const partyId = caps.fixedParty ? input.ownPartyId : input.state.statementParty;
  if (!partyId) {
    return {
      query: null,
      missing: caps.fixedParty ? null : `Choose the ${PARTY_KIND_LABELS[kind].toLowerCase()}.`,
    };
  }
  return { query: { ...base, partyId }, missing: null };
}

