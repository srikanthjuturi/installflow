import en from '@/i18n/locales/en.json';
import {
  PART_PILL,
  UNKNOWN_PILL,
  blocksCompletion,
  isOpen,
  needPartMode,
  partPill,
  partTrail,
} from '@/features/parts/partStatus';
import type { PartRequest } from '@/features/parts/types';

function request(over: Partial<PartRequest> = {}): PartRequest {
  return {
    id: 'r1',
    code: 'RGT-SPR-0007',
    partName: 'Drain pump',
    isOther: false,
    note: null,
    status: 'requested',
    createdAt: '2026-10-15T05:30:00Z',
    decidedAt: null,
    rejectReason: null,
    rejectedAfterApproval: false,
    issuedAt: null,
    issueNote: null,
    returnedAt: null,
    ...over,
  };
}

/** Dot-path lookup into the English file — the key must exist, not just type-check. */
function exists(key: string): boolean {
  let node: unknown = en;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in (node as object))) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string';
}

describe('partPill', () => {
  it('maps all five statuses to a key and a tone', () => {
    expect(partPill('requested')).toEqual({ label: 'parts.state.requested', tone: 'secondary' });
    expect(partPill('approved')).toEqual({ label: 'parts.state.approved', tone: 'primary' });
    expect(partPill('issued')).toEqual({ label: 'parts.state.issued', tone: 'success' });
    expect(partPill('returned')).toEqual({ label: 'parts.state.returned', tone: 'neutral' });
    expect(partPill('rejected')).toEqual({ label: 'parts.state.rejected', tone: 'danger' });
  });

  it('reads a request rejected after approval as "Approval cancelled"', () => {
    expect(partPill('rejected', true)).toEqual({ label: 'parts.state.cancelled', tone: 'danger' });
    expect(partPill('rejected', false)).toEqual(PART_PILL.rejected);
  });

  it('ignores the flag on any other status', () => {
    expect(partPill('issued', true)).toEqual(PART_PILL.issued);
    expect(partPill('approved', true)).toEqual(PART_PILL.approved);
  });

  it('falls back to "Updated" for anything it does not know', () => {
    for (const status of ['cancelled', '', 'constructor', '__proto__', undefined, 42, null]) {
      expect(partPill(status)).toBe(UNKNOWN_PILL);
    }
  });

  it('only names keys that exist in en.json', () => {
    const keys = [...Object.values(PART_PILL), UNKNOWN_PILL, partPill('rejected', true)].map(
      (p) => p.label,
    );
    for (const key of keys) expect(exists(key)).toBe(true);
  });
});

describe('isOpen / blocksCompletion', () => {
  it('treats only requested and approved as open', () => {
    expect(isOpen('requested')).toBe(true);
    expect(isOpen('approved')).toBe(true);
    for (const s of ['issued', 'returned', 'rejected', 'weird', undefined]) {
      expect(isOpen(s)).toBe(false);
    }
  });

  it('blocks completion only while a request is open', () => {
    expect(blocksCompletion([])).toBe(false);
    expect(
      blocksCompletion([{ status: 'issued' }, { status: 'rejected' }, { status: 'returned' }]),
    ).toBe(false);
    expect(blocksCompletion([{ status: 'issued' }, { status: 'requested' }])).toBe(true);
    expect(blocksCompletion([{ status: 'approved' }])).toBe(true);
    expect(blocksCompletion([{ status: 'from-the-future' }])).toBe(false);
  });
});

describe('needPartMode', () => {
  it('offers the button unless the franchise has no parts store', () => {
    expect(needPartMode(true, true)).toBe('button');
    expect(needPartMode(true, null)).toBe('button');
    expect(needPartMode(true, undefined)).toBe('button');
    expect(needPartMode(true, false)).toBe('unavailable');
  });

  it('shows nothing when the stage cannot request', () => {
    expect(needPartMode(false, false)).toBe('none');
    expect(needPartMode(false, true)).toBe('none');
  });
});

describe('partTrail', () => {
  const keys = (r: PartRequest) => partTrail(r).map((l) => l.key);

  it('requested: only the waiting hint', () => {
    expect(keys(request())).toEqual(['parts.hint.requested']);
  });

  it('approved: when, then the hint', () => {
    const lines = partTrail(request({ status: 'approved', decidedAt: '2026-10-16T04:00:00Z' }));
    expect(lines.map((l) => l.key)).toEqual(['parts.trail.approved', 'parts.hint.approved']);
    expect(lines[0]?.params).toEqual({ when: '2026-10-16T04:00:00Z' });
  });

  it('issued: approved, issued, the store note, then the hint', () => {
    const r = request({
      status: 'issued',
      decidedAt: '2026-10-16T04:00:00Z',
      issuedAt: '2026-10-17T04:00:00Z',
      issueNote: 'Collect at counter 2',
    });
    expect(keys(r)).toEqual([
      'parts.trail.approved',
      'parts.trail.issued',
      'parts.trail.issuedNote',
      'parts.hint.issued',
    ]);
    expect(partTrail(r)[2]?.params).toEqual({ note: 'Collect at counter 2' });
  });

  it('issued without a note skips the note line', () => {
    expect(keys(request({ status: 'issued' }))).toEqual([
      'parts.trail.approved',
      'parts.trail.issued',
      'parts.hint.issued',
    ]);
  });

  it('returned: three lines ending on the hand-back', () => {
    const lines = partTrail(request({ status: 'returned', returnedAt: '2026-10-18T04:00:00Z' }));
    expect(lines.map((l) => l.key)).toEqual([
      'parts.trail.approved',
      'parts.trail.issued',
      'parts.trail.returned',
    ]);
    expect(lines[2]?.params).toEqual({ when: '2026-10-18T04:00:00Z' });
  });

  it('rejected: one line carrying the reason', () => {
    const lines = partTrail(
      request({ status: 'rejected', decidedAt: '2026-10-16T04:00:00Z', rejectReason: 'Out of stock' }),
    );
    expect(lines).toEqual([
      {
        key: 'parts.trail.rejected',
        params: { when: '2026-10-16T04:00:00Z', reason: 'Out of stock' },
      },
    ]);
  });

  it('rejected after approval: its own line, with the reason', () => {
    const lines = partTrail(
      request({
        status: 'rejected',
        rejectedAfterApproval: true,
        decidedAt: '2026-10-16T04:00:00Z',
        rejectReason: 'supplier failed',
      }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.key).toBe('parts.trail.rejectedAfterApproval');
    expect(lines[0]?.params.reason).toBe('supplier failed');
  });

  it('an unknown status has no trail', () => {
    expect(partTrail(request({ status: 'from-the-future' }))).toEqual([]);
  });

  it('only names keys that exist in en.json', () => {
    const all: PartRequest[] = [
      request(),
      request({ status: 'approved' }),
      request({ status: 'issued', issueNote: 'x' }),
      request({ status: 'returned' }),
      request({ status: 'rejected' }),
      request({ status: 'rejected', rejectedAfterApproval: true }),
    ];
    for (const r of all) for (const line of partTrail(r)) expect(exists(line.key)).toBe(true);
  });
});
