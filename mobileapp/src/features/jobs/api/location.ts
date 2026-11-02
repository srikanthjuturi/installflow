import { authedRequest } from '@/lib/api';

export interface LocationFix {
  latitude: number;
  longitude: number;
  /** Metres. */
  accuracyM?: number;
  /** ISO time the fix was taken. */
  recordedAt?: string;
}

export interface LocationAck {
  accepted: boolean;
  nextAfterSeconds: number;
}

/**
 * `POST /jobs/:id/location` — the technician's latest position while the job is
 * active. Only the latest point is stored. `accepted: false` means "too soon",
 * which is not a failure. 409 `JOB_NOT_ACTIVE` and 404 mean stop sending.
 */
export function reportLocation(jobId: string, fix: LocationFix): Promise<LocationAck> {
  return authedRequest<LocationAck>(`/jobs/${jobId}/location`, { method: 'POST', body: fix });
}
