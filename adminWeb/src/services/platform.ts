/**
 * Platform transport — live FastAPI, the superadmin's side of credits.
 *
 * `require_superadmin` on every call: the one guard a principal with no company
 * passes. **Confirming a recharge is the only way credits are ever bought** —
 * the company claims it paid, and this is the door that says it arrived.
 */

import type { ListParams, Page } from "@/types/api";
import type {
  PlatformRecharge,
  PlatformRechargeDetail,
  PlatformSettings,
  PlatformSettingsInput,
} from "@/types/platform";
import { apiGet, apiGetPage, apiPost, apiPut } from "./http";

export function getPlatformSettings(): Promise<PlatformSettings> {
  return apiGet<PlatformSettings>("/platform/settings");
}

export function savePlatformSettings(
  body: PlatformSettingsInput
): Promise<PlatformSettings> {
  return apiPut<PlatformSettings>("/platform/settings", body);
}

/** Every company's recharges. `filters.state` — `waiting` reads oldest first. */
export function listPlatformRecharges(
  params: ListParams = {}
): Promise<Page<PlatformRecharge>> {
  return apiGetPage<PlatformRecharge>("/platform/recharges", params);
}

/** Claims nobody has decided — the rail badge and the bell's number. */
export async function waitingRechargeCount(): Promise<number> {
  const { waiting } = await apiGet<{ waiting: number }>("/platform/recharges/count");
  return waiting;
}

/** The bell's dropdown: the latest claims waiting for a decision. */
export function listWaitingRecharges(): Promise<PlatformRecharge[]> {
  return apiGet<PlatformRecharge[]>("/platform/recharges/waiting");
}

export function getPlatformRecharge(id: string): Promise<PlatformRechargeDetail> {
  return apiGet<PlatformRechargeDetail>(`/platform/recharges/${id}`);
}

/** It arrived — add the credits. Idempotent. 409 `NOT_WAITING` if already decided otherwise. */
export function confirmRecharge(id: string): Promise<PlatformRechargeDetail> {
  return apiPost<PlatformRechargeDetail>(`/platform/recharges/${id}/confirm`);
}

/** It did not arrive, or does not match. Final; the company reads the reason. */
export function rejectRecharge({
  id,
  reason,
}: {
  id: string;
  reason: string;
}): Promise<PlatformRechargeDetail> {
  return apiPost<PlatformRechargeDetail>(`/platform/recharges/${id}/reject`, {
    reason,
  });
}
