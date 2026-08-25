import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { completeJob, submitProof, uploadShot } from '@/features/proof/api/proof';
import { qk } from '@/lib/queryKeys';
import { allShots, useCaptureStore, type CapturedShot } from '@/store/capture.store';
import type { ProofKind } from '@/types/domain';

/**
 * Upload one shot in the background, the moment it is captured.
 *
 * Fire-and-forget from the caller's point of view — the shutter must not wait
 * on a network round trip, or a technician on a slow site would think the
 * camera had frozen. Progress lands in the store, which the review screen
 * renders and which gates the submit button.
 *
 * Not a `useMutation`: this is one call per image with per-image state that
 * already lives in Zustand, and Query's single mutation state cannot represent
 * four uploads in flight at once.
 */
export function useUploadShot() {
  const markUpload = useCaptureStore((s) => s.markUpload);

  return useCallback(
    (shot: CapturedShot) => {
      markUpload(shot.uri, { upload: 'uploading', error: undefined });
      uploadShot(shot.uri)
        .then((blobName) => markUpload(shot.uri, { upload: 'done', blobName }))
        .catch((error: unknown) =>
          markUpload(shot.uri, {
            upload: 'failed',
            error: error instanceof Error ? error.message : 'Upload failed',
          }),
        );
    },
    [markUpload],
  );
}

/** Retry every shot that failed, from the review screen. */
export function useRetryFailedUploads() {
  const upload = useUploadShot();

  return useCallback(() => {
    const state = useCaptureStore.getState();
    allShots(state)
      .filter(({ shot }) => shot.upload === 'failed')
      .forEach(({ shot }) => upload(shot));
  }, [upload]);
}

/**
 * Submit the captured set and start the job.
 *
 * Seeds the job cache with what comes back, for the same reason `useAcceptJob`
 * does: the response IS the updated job, and throwing it away to refetch would
 * put a spinner between the technician and the screen they just earned.
 */
export function useSubmitProof(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => {
      const shots = allShots(useCaptureStore.getState()) as {
        kind: ProofKind;
        shot: CapturedShot;
      }[];
      return submitProof(jobId, shots);
    },
    onSuccess: (job) => {
      queryClient.setQueryData(qk.job(jobId), job);
      void queryClient.invalidateQueries({ queryKey: ['jobs', 'mine'] });
      void queryClient.invalidateQueries({ queryKey: [...qk.myJobs('all'), 'today'] });
    },
  });
}

/** Mark the work finished and send the customer their confirmation link. */
export function useCompleteJob(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => completeJob(jobId),
    onSuccess: (job) => {
      queryClient.setQueryData(qk.job(jobId), job);
      void queryClient.invalidateQueries({ queryKey: ['jobs', 'mine'] });
      void queryClient.invalidateQueries({ queryKey: [...qk.myJobs('all'), 'today'] });
    },
  });
}
