import type { PartRequestBody } from '@/features/parts/picker';
import type { CataloguePart, JobParts, PartRequest } from '@/features/parts/types';
import { authedRequest } from '@/lib/api';

/**
 * Spare parts on one of my jobs — Task 12 §4.4.
 *
 *   getJobParts → GET  /jobs/:id/parts          (any status — history stays readable)
 *   requestPart → POST /jobs/:id/part-requests  (201 requested · 200 already requested)
 *
 * A job that is not the caller's answers 404, like every other job route.
 */

interface PartRequestDto {
  id: string;
  code: string;
  partName: string;
  isOther?: boolean;
  note?: string | null;
  status: string;
  createdAt: string;
  decidedAt?: string | null;
  rejectReason?: string | null;
  rejectedAfterApproval?: boolean;
  issuedAt?: string | null;
  issueNote?: string | null;
  returnedAt?: string | null;
}

interface JobPartsDto {
  partsEnabled?: boolean;
  canRequest?: boolean;
  catalogue?: CataloguePart[];
  requests?: PartRequestDto[];
}

function toRequest(dto: PartRequestDto): PartRequest {
  return {
    id: dto.id,
    code: dto.code,
    partName: dto.partName,
    isOther: dto.isOther ?? false,
    note: dto.note ?? null,
    status: dto.status,
    createdAt: dto.createdAt,
    decidedAt: dto.decidedAt ?? null,
    rejectReason: dto.rejectReason ?? null,
    rejectedAfterApproval: dto.rejectedAfterApproval ?? false,
    issuedAt: dto.issuedAt ?? null,
    issueNote: dto.issueNote ?? null,
    returnedAt: dto.returnedAt ?? null,
  };
}

/** `?? []` / `?? false` throughout: an older server sends none of it. */
function toJobParts(dto: JobPartsDto): JobParts {
  return {
    // Null = not said. Never `?? true`/`?? false`: absent must not decide.
    partsEnabled: dto.partsEnabled ?? null,
    canRequest: dto.canRequest ?? false,
    catalogue: dto.catalogue ?? [],
    requests: (dto.requests ?? []).map(toRequest),
  };
}

export async function getJobParts(jobId: string): Promise<JobParts> {
  return toJobParts(await authedRequest<JobPartsDto>(`/jobs/${jobId}/parts`));
}

export async function requestPart(jobId: string, body: PartRequestBody): Promise<JobParts> {
  return toJobParts(
    await authedRequest<JobPartsDto>(`/jobs/${jobId}/part-requests`, { method: 'POST', body }),
  );
}
