/**
 * Company <-> franchisee transfers — live FastAPI, both doors of one slice.
 *
 * The company's Admin / National Head (`finance.settlements`) talks to
 * `/franchise-settlements`; a franchisee's admin (`franchise.settlements`) to
 * `/franchise/settlements`. The shapes are identical, so one set of functions
 * takes the `side`.
 *
 * The portal never sends a franchisee id — the server uses the caller's own
 * (hard rule 0). The sender can never confirm their own transfer; the server
 * answers 409 `NOT_THE_RECEIVER`.
 */

import type { ListParams, Page } from "@/types/api";
import type {
  RecordSettlementInput,
  Settlement,
  SettlementCount,
  SettlementFranchisee,
  SettlementSide,
  SettlementSummary,
} from "@/types/franchiseSettlement";
import { apiGet, apiGetPage, apiPost } from "./http";

const BASE: Record<SettlementSide, string> = {
  staff: "/franchise-settlements",
  portal: "/franchise/settlements",
};

export function listSettlements(
  side: SettlementSide,
  params: ListParams = {}
): Promise<Page<Settlement>> {
  return apiGetPage<Settlement>(BASE[side], params);
}

/** Transfers waiting for THIS side to confirm — the rail badge. */
export function getSettlementCount(side: SettlementSide): Promise<SettlementCount> {
  return apiGet<SettlementCount>(`${BASE[side]}/count`);
}

/** Confirmed money only. `franchiseeId` narrows it, on the staff door alone. */
export function getSettlementSummary(
  side: SettlementSide,
  franchiseeId?: string
): Promise<SettlementSummary> {
  const q =
    side === "staff" && franchiseeId
      ? `?franchiseeId=${encodeURIComponent(franchiseeId)}`
      : "";
  return apiGet<SettlementSummary>(`${BASE[side]}/summary${q}`);
}

/** Non-home franchisees, for the staff form and filter. Staff door only. */
export function listSettlementFranchisees(): Promise<SettlementFranchisee[]> {
  return apiGet<SettlementFranchisee[]>(`${BASE.staff}/franchisees`);
}

/**
 * Record money THIS side sent. The screenshot goes up first through
 * `POST /uploads?kind=attachment`; a blob NAME travels here.
 */
export function recordSettlement(
  side: SettlementSide,
  input: RecordSettlementInput
): Promise<Settlement> {
  // Defensive: the portal's body must not name a franchisee.
  const body =
    side === "portal" ? { ...input, franchiseeId: undefined } : input;
  return apiPost<Settlement>(BASE[side], body);
}

/** It arrived. The receiving side's word, and the only way a row settles. */
export function confirmSettlement(
  side: SettlementSide,
  id: string
): Promise<Settlement> {
  return apiPost<Settlement>(`${BASE[side]}/${id}/confirm`);
}

/** It did not arrive. Final — the sender records a new one. */
export function declineSettlement(
  side: SettlementSide,
  input: { id: string; reason: string }
): Promise<Settlement> {
  return apiPost<Settlement>(`${BASE[side]}/${input.id}/decline`, {
    reason: input.reason,
  });
}
