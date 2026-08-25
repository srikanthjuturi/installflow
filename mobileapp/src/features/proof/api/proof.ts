import { toAcceptedJob, type JobDto } from '@/features/jobs/api/jobs';
import { authedRequest } from '@/lib/api';
import { uploadImage } from '@/lib/uploads';
import type { CapturedShot } from '@/store/capture.store';
import type { Job, ProofKind } from '@/types/domain';

/**
 * Proof capture, for real.
 *
 * Two calls and they are deliberately separate:
 *
 *   `uploadShot`   one image → blob storage, as soon as it is taken
 *   `submitProof`  the whole set → `POST /jobs/:id/proof`, which is also what
 *                  moves the job to In Progress
 *
 * Splitting them is the point. Uploading at submit time would mean a technician
 * finishes four captures on a bad connection and only then finds out none of it
 * went; uploading per shot means the failure surfaces on the screen that can
 * retake it.
 */

/** One image to blob storage. Resolves to the opaque name to submit later. */
export function uploadShot(uri: string): Promise<string> {
  return uploadImage(uri, 'proof');
}

interface ArtifactBody {
  kind: ProofKind;
  blobName: string;
  capturedAt: string;
  ordinal: number;
  latitude?: number;
  longitude?: number;
  accuracyM?: number;
  devicePincode?: string;
}

function toArtifact(kind: ProofKind, shot: CapturedShot, ordinal: number): ArtifactBody {
  const body: ArtifactBody = {
    kind,
    // Non-null by construction: `isProofUploaded` gates the call.
    blobName: shot.blobName as string,
    // The PHONE's clock at the shutter, not now. A technician can be offline
    // between capturing and submitting, and when it was taken is the fact.
    capturedAt: new Date(shot.capturedAt).toISOString(),
    ordinal,
  };
  if (shot.coords) {
    body.latitude = shot.coords.latitude;
    body.longitude = shot.coords.longitude;
    if (shot.coords.accuracy !== null) body.accuracyM = shot.coords.accuracy;
    // The server re-checks this against the ticket's pincode and refuses a
    // mismatch. Sending it is not a formality — it is what makes the block on
    // the shutter more than a rendering choice.
    if (shot.coords.pincode) body.devicePincode = shot.coords.pincode;
  }
  return body;
}

/**
 * Submit every artifact and start the job.
 *
 * The server re-counts the set and refuses an incomplete one — it does not take
 * this client's word for what "all four" means, which is right: the thing making
 * the claim should not be the thing that validates it.
 */
export async function submitProof(
  jobId: string,
  shots: { kind: ProofKind; shot: CapturedShot }[],
  serial: { value: string | null; source: 'scanned' | 'manual' | null },
): Promise<Job> {
  // `ordinal` counts within a kind: 1 for the three single shots, 1..4 for
  // product photos in the order they were taken.
  const seen: Partial<Record<ProofKind, number>> = {};
  const artifacts = shots.map(({ kind, shot }) => {
    const next = (seen[kind] ?? 0) + 1;
    seen[kind] = next;
    return toArtifact(kind, shot, next);
  });

  return toAcceptedJob(
    await authedRequest<JobDto>(`/jobs/${jobId}/proof`, {
      method: 'POST',
      body: {
        artifacts,
        // The server compares this with the ticket's expected serial and
        // records a mismatch. It never refuses one — see `submit_proof`.
        observedSerial: serial.value,
        observedSerialSource: serial.source,
      },
    }),
  );
}

/**
 * The technician says the work is finished, and the customer is asked to agree.
 *
 * This does NOT close the job. It moves to `Awaiting Customer` and stays there
 * until the customer answers the WhatsApp link — the whole reason the feature
 * exists is that the person who did the work is not the person who declares it
 * done.
 */
export async function completeJob(jobId: string): Promise<Job> {
  return toAcceptedJob(
    await authedRequest<JobDto>(`/jobs/${jobId}/complete`, { method: 'POST' }),
  );
}
