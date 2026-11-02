import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getPartsAddress,
  removePartsAddress,
  savePartsAddress,
} from '@/features/parts-address/api/partsAddress';
import { qk } from '@/lib/queryKeys';

/** The saved parts delivery address, or null when there is none. */
export function usePartsAddress() {
  return useQuery({ queryKey: qk.partsAddress(), queryFn: getPartsAddress });
}

export function useSavePartsAddress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: savePartsAddress,
    onSuccess: (saved) => {
      queryClient.setQueryData(qk.partsAddress(), saved);
      void queryClient.invalidateQueries({ queryKey: qk.partsAddress() });
    },
  });
}

export function useRemovePartsAddress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: removePartsAddress,
    onSuccess: () => {
      queryClient.setQueryData(qk.partsAddress(), null);
      void queryClient.invalidateQueries({ queryKey: qk.partsAddress() });
    },
  });
}
