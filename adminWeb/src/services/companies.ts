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

export function listCompanies(params: ListParams = {}): Promise<Page<Company>> {
  return apiGetPage<Company>("/companies", params);
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
