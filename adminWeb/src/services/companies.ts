/**
 * Companies (tenants) — superadmin service, against the live backend.
 *
 * Thin wrappers over the real HTTP transport; every function returns typed
 * domain objects with the envelope already unwrapped. Hooks in
 * `hooks/useCompanies.ts` wrap these — components never import from here.
 */

import { apiDelete, apiGet, apiGetPage, apiPatch, apiPost, apiPut } from "./http";
import type { ListParams, Page } from "@/types/api";
import type {
  Company,
  CreatedCompany,
  CreateCompanyInput,
  UpdateCompanyInput,
} from "@/types/company";
import type { GstinLookup } from "@/types/gst";

export function listCompanies(params: ListParams = {}): Promise<Page<Company>> {
  return apiGetPage<Company>("/companies", params);
}

/**
 * What the GST registry says about a GSTIN — the company form's autofill.
 *
 * The superadmin twin of `lookupGstin` in `services/vendors.ts`. Same registry,
 * same answer, one shared implementation on the server; the routes differ only
 * because a superadmin holds no membership and no company feature, so the
 * vendors route refuses them outright.
 *
 * Answers 200 for a GSTIN that is not registered and for a portal that could
 * not be reached — read `outcome`, do not rely on a rejection.
 */
export function lookupCompanyGstin(gstin: string): Promise<GstinLookup> {
  return apiPost<GstinLookup>("/companies/gstin-lookup", { gstin });
}

export function getCompany(id: string): Promise<Company> {
  return apiGet<Company>(`/companies/${id}`);
}

export function createCompany(
  input: CreateCompanyInput
): Promise<CreatedCompany> {
  return apiPost<CreatedCompany>("/companies", input);
}

export function updateCompany(
  id: string,
  input: UpdateCompanyInput
): Promise<Company> {
  return apiPut<Company>(`/companies/${id}`, input);
}

export function setCompanyStatus(
  id: string,
  isActive: boolean
): Promise<Company> {
  return apiPatch<Company>(`/companies/${id}/status`, { isActive });
}

export function deleteCompany(id: string): Promise<null> {
  return apiDelete<null>(`/companies/${id}`);
}
