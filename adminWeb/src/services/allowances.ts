/**
 * Travel and speed allowance rules — Task 13 §5.3. Live FastAPI.
 *
 * ⚠ The staff prefixes differ and this file is where that stops: travel is
 * `/settings/travel` (the company's HOME franchisee, implied) while speed is
 * `/franchisees/{id}/speed-rules` (Task 10 and Task 11 were written apart).
 * A component never builds either URL — it passes an `AllowanceScope`.
 *
 * **Paise on the wire** for every figure here (unlike `/settings/rules`).
 */

import type {
  AllowanceScope,
  SpeedCatalogue,
  SpeedRule,
  SpeedRuleInput,
  TravelRules,
} from "@/types/allowances";
import { apiDelete, apiGet, apiPut } from "./http";

const travelPath = (s: AllowanceScope) =>
  s.kind === "franchise"
    ? "/franchise/settings/travel"
    : s.kind === "home"
      ? "/settings/travel"
      : `/franchisees/${s.franchiseeId}/travel-rules`;

const speedPath = (s: AllowanceScope) =>
  s.kind === "franchise"
    ? "/franchise/settings/speed"
    : `/franchisees/${s.franchiseeId}/speed-rules`;

export const getTravelRules = (s: AllowanceScope) =>
  apiGet<TravelRules>(travelPath(s));

/** The body carries both types and never a franchisee — the URL names whose. */
export const saveTravelRules = (s: AllowanceScope, body: TravelRules) =>
  apiPut<TravelRules>(travelPath(s), body);

export const listSpeedRules = (s: AllowanceScope) =>
  apiGet<SpeedRule[]>(speedPath(s));

/** An UPSERT on type + target: the same pair overwrites the row in place. */
export const saveSpeedRule = (s: AllowanceScope, body: SpeedRuleInput) =>
  apiPut<SpeedRule>(speedPath(s), body);

export const deleteSpeedRule = (s: AllowanceScope, id: string) =>
  apiDelete<{ deleted: true }>(`${speedPath(s)}/${id}`);

/**
 * The price-free tree a franchise principal picks a speed target from (W16).
 * Staff read `GET /masters/nodes` instead — this door is theirs alone.
 */
export const getSpeedCatalogue = () =>
  apiGet<SpeedCatalogue>("/franchise/settings/speed/catalogue");
