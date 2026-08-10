import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { ListParams } from "@/types/api";
import type { CreateCompanyInput, UpdateCompanyInput } from "@/types/company";
import {
  createCompany,
  deleteCompany,
  listCompanies,
  setCompanyStatus,
  updateCompany,
} from "@/services/companies";

/**
 * Companies data layer. Query keys are prefixed so a single mutation
 * invalidates every page/filter of the list at once. Toasts fire in the
 * component (house convention), not here.
 */
export const companyKeys = {
  all: ["companies"] as const,
  list: () => ["companies", "list"] as const,
  page: (params: ListParams) => ["companies", "list", params] as const,
};

export function useCompanies(params: ListParams) {
  return useQuery({
    queryKey: companyKeys.page(params),
    queryFn: () => listCompanies(params),
    placeholderData: keepPreviousData, // table never blanks on page/search change
  });
}

function useInvalidateCompanies() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: companyKeys.list() });
}

export function useCreateCompany() {
  const invalidate = useInvalidateCompanies();
  return useMutation({
    meta: { errorTitle: "Couldn't save the company" },
    mutationFn: (input: CreateCompanyInput) => createCompany(input),
    onSuccess: invalidate,
  });
}

export function useUpdateCompany() {
  const invalidate = useInvalidateCompanies();
  return useMutation({
    meta: { errorTitle: "Couldn't save the company" },
    mutationFn: ({ id, input }: { id: string; input: UpdateCompanyInput }) =>
      updateCompany(id, input),
    onSuccess: invalidate,
  });
}

export function useSetCompanyStatus() {
  const invalidate = useInvalidateCompanies();
  return useMutation({
    meta: { errorTitle: "Couldn't change the company status" },
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      setCompanyStatus(id, isActive),
    onSuccess: invalidate,
  });
}

export function useDeleteCompany() {
  const invalidate = useInvalidateCompanies();
  return useMutation({
    meta: { errorTitle: "Couldn't delete the company" },
    mutationFn: (id: string) => deleteCompany(id),
    onSuccess: invalidate,
  });
}
