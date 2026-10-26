import type { ParseKeys } from 'i18next';

import type { PillTone } from '@/components/ui';
import type { PartRequest, PartRequestStatus } from '@/features/parts/types';

/**
 * The pill for each request state — the `redeem/format.ts` `STATE_PILL` pattern.
 * Task 15 PROPOSED copy; a screen calls `t()` on the label at render.
 */
export const PART_PILL = {
  requested: { label: 'parts.state.requested', tone: 'secondary' },
  approved: { label: 'parts.state.approved', tone: 'primary' },
  issued: { label: 'parts.state.issued', tone: 'success' },
  returned: { label: 'parts.state.returned', tone: 'neutral' },
  rejected: { label: 'parts.state.rejected', tone: 'danger' },
} as const satisfies Record<PartRequestStatus, { label: ParseKeys; tone: PillTone }>;

/** A state newer than this build: say it changed, claim nothing else. */
export const UNKNOWN_PILL = { label: 'parts.state.unknown', tone: 'neutral' } as const;

/** Owner ruling R2: rejected AFTER approval reads "Approval cancelled". */
const CANCELLED_PILL = { label: 'parts.state.cancelled', tone: 'danger' } as const;

type Pill = { label: ParseKeys; tone: PillTone };

/**
 * Own-property lookup, total: `'constructor'` and `'__proto__'` must not find
 * the object's prototype members, and a status the app has never heard of is
 * `UNKNOWN_PILL` rather than an exception.
 */
export function partPill(status: unknown, rejectedAfterApproval?: boolean): Pill {
  if (typeof status !== 'string' || !Object.prototype.hasOwnProperty.call(PART_PILL, status)) {
    return UNKNOWN_PILL;
  }
  if (status === 'rejected' && rejectedAfterApproval) return CANCELLED_PILL;
  return PART_PILL[status as PartRequestStatus];
}

/** Still with the parts store: asked for, or approved and not yet handed over. */
export function isOpen(status: unknown): boolean {
  return status === 'requested' || status === 'approved';
}

/**
 * Whether Complete must wait. A request rejected after approval is NOT open —
 * the job returns to In Progress once nothing is requested or approved.
 * The server's `PARTS_PENDING` is still the final word.
 */
export function blocksCompletion(requests: Pick<PartRequest, 'status'>[]): boolean {
  return requests.some((r) => isOpen(r.status));
}

/**
 * Owner ruling R4. `'button'` offers Need a spare part; `'unavailable'` says the
 * franchise has no parts store; `'none'` shows nothing (the stage cannot
 * request). A server that said nothing (`null`/`undefined`) is read as enabled.
 */
export function needPartMode(
  canRequestPart: boolean,
  partsEnabled: boolean | null | undefined,
): 'button' | 'unavailable' | 'none' {
  if (!canRequestPart) return 'none';
  return partsEnabled === false ? 'unavailable' : 'button';
}

export interface TrailLine {
  key: ParseKeys;
  /** Dates stay ISO (`when`); the card words them at render. */
  params: Record<string, string>;
}

/** Ordered lines under a request on the card — keys and params, no words. */
export function partTrail(r: PartRequest): TrailLine[] {
  const approved = (): TrailLine => ({
    key: 'parts.trail.approved',
    params: { when: r.decidedAt ?? '' },
  });
  const issued = (): TrailLine => ({
    key: 'parts.trail.issued',
    params: { when: r.issuedAt ?? '' },
  });

  switch (r.status) {
    case 'requested':
      return [{ key: 'parts.hint.requested', params: {} }];
    case 'approved':
      return [approved(), { key: 'parts.hint.approved', params: {} }];
    case 'issued': {
      const lines = [approved(), issued()];
      if (r.issueNote) lines.push({ key: 'parts.trail.issuedNote', params: { note: r.issueNote } });
      lines.push({ key: 'parts.hint.issued', params: {} });
      return lines;
    }
    case 'returned':
      return [
        approved(),
        issued(),
        { key: 'parts.trail.returned', params: { when: r.returnedAt ?? '' } },
      ];
    case 'rejected':
      return [
        {
          key: r.rejectedAfterApproval ? 'parts.trail.rejectedAfterApproval' : 'parts.trail.rejected',
          params: { when: r.decidedAt ?? '', reason: r.rejectReason ?? '' },
        },
      ];
    default:
      return [];
  }
}
