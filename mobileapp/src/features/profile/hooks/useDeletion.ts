import { useMutation } from '@tanstack/react-query';

import { confirmDeletion, sendDeletionCode } from '@/features/profile/api/deletion';

/** Step one of deleting your own account: a code to your own WhatsApp. */
export function useSendDeletionCode() {
  return useMutation({ mutationFn: sendDeletionCode });
}

/**
 * Step two: check the code. On success the account is already gone — the
 * caller tears down the session the same way "Log out" does.
 */
export function useConfirmDeletion() {
  return useMutation({
    mutationFn: (code: string) => confirmDeletion(code),
  });
}
