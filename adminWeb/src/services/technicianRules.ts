/**
 * A technician's own rules and holding — live FastAPI, both doors (Epic 3).
 * The staff door and the franchise portal's twin answer the same shapes.
 */

import { apiGet, apiPut } from "./http";
import type {
  HoldingInput,
  TechnicianRules,
  TechnicianRulesInput,
} from "@/types/technicianRules";

const door = (franchise: boolean) => (franchise ? "/franchise/technicians" : "/technicians");

function build(franchise: boolean) {
  const base = door(franchise);
  return {
    get: (id: string) => apiGet<TechnicianRules>(`${base}/${id}/rules`),
    put: ({ id, body }: { id: string; body: TechnicianRulesInput }) =>
      apiPut<TechnicianRules>(`${base}/${id}/rules`, body),
    putHolding: ({ id, body }: { id: string; body: HoldingInput }) =>
      apiPut<TechnicianRules>(`${base}/${id}/holding`, body),
  };
}

export const staffRules = build(false);
export const franchiseRules = build(true);
