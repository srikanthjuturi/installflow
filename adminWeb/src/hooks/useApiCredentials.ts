import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createApiCredential,
  listApiCredentials,
  listApiLogs,
  replaceApiCredential,
  revokeApiCredential,
} from "@/services/apiCredentials";
import type { ListParams } from "@/types/api";

/**
 * One prefix for the slice, so a write that changes the credentials list also
 * refreshes the log (a revoked credential's next call is a refusal).
 */
export const apiCredentialKeys = {
  all: ["api-credentials"] as const,
  list: (vendorId?: string) => ["api-credentials", "list", vendorId ?? ""] as const,
  logs: (params: ListParams) => ["api-credentials", "logs", params] as const,
};

export function useApiCredentials(vendorId?: string) {
  return useQuery({
    queryKey: apiCredentialKeys.list(vendorId),
    queryFn: () => listApiCredentials(vendorId),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

function useCredentialMutation<TIn, TOut>(
  fn: (input: TIn) => Promise<TOut>,
  errorTitle: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle },
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: apiCredentialKeys.all });
    },
  });
}

/** The response carries the one-time `clientSecret` — read it in `onSuccess`. */
export const useCreateApiCredential = () =>
  useCredentialMutation(createApiCredential, "Couldn't generate the credential");

export const useReplaceApiCredential = () =>
  useCredentialMutation(replaceApiCredential, "Couldn't replace the credential");

export const useRevokeApiCredential = () =>
  useCredentialMutation(revokeApiCredential, "Couldn't revoke the credential");

export function useApiLogs(params: ListParams) {
  return useQuery({
    queryKey: apiCredentialKeys.logs(params),
    queryFn: () => listApiLogs(params),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}
