import { delay } from '@/mocks/delay';
import type { VerificationOutcome } from '@/types/domain';

export interface Verification {
  id: string;
  status: 'pending' | VerificationOutcome;
  /** 0–100. Present once the run finishes. */
  confidence?: number;
  serialRead?: string;
  modelMatched?: string;
}

/**
 * Which outcome a job produces. Deterministic rather than random so all three
 * states are demonstrable on demand — a live demo shouldn't depend on a dice
 * roll, and each branch has genuinely different UI that needs checking.
 */
const FORCED: Record<string, VerificationOutcome> = {
  'INST-4830': 'mismatch',
  'INST-4847': 'unreadable',
};

/** How many polls before a result lands — mimics a real async AI pipeline. */
const POLLS_UNTIL_DONE = 3;
const pollCounts = new Map<string, number>();

/** Binding phase: `POST /jobs/:id/proof/:proofId/submit` → `{ verificationId }`. */
export async function submitProof(jobId: string): Promise<{ verificationId: string }> {
  await delay(`submit:${jobId}`, 500, 900);
  const verificationId = `VER-${jobId}`;
  pollCounts.set(verificationId, 0);
  return { verificationId };
}

/**
 * Binding phase: `GET /verifications/:id`.
 *
 * Polled rather than resolved in one call. The prototype fakes this with a
 * 2.4s setTimeout, but real inference is asynchronous — building against the
 * fake produces a UI that can't cope with a slow or stuck verification.
 */
export async function getVerification(
  verificationId: string,
  jobId: string,
  model: string,
): Promise<Verification> {
  await delay(`verify:${verificationId}`, 700, 1100);

  const seen = (pollCounts.get(verificationId) ?? 0) + 1;
  pollCounts.set(verificationId, seen);

  if (seen < POLLS_UNTIL_DONE) {
    return { id: verificationId, status: 'pending' };
  }

  const outcome = FORCED[jobId] ?? 'match';

  if (outcome === 'unreadable') {
    return { id: verificationId, status: 'unreadable', confidence: 34 };
  }

  if (outcome === 'mismatch') {
    return {
      id: verificationId,
      status: 'mismatch',
      confidence: 61,
      serialRead: 'VCN-400097-2210',
      modelMatched: model,
    };
  }

  return {
    id: verificationId,
    status: 'match',
    confidence: 98,
    serialRead: 'VCN-400067-8841',
    modelMatched: model,
  };
}

/** Binding phase: `POST /jobs/:id/closure/feedback-link`. */
export async function sendFeedbackLink(jobId: string): Promise<void> {
  await delay(`feedback:${jobId}`, 400, 700);
}
