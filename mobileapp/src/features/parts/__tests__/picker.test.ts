import {
  MAX_NOTE,
  MAX_OTHER,
  OTHER,
  buildPartRequest,
  filterParts,
  wasAlreadyRequested,
} from '@/features/parts/picker';
import type { PartRequest } from '@/features/parts/types';

const PARTS = [
  { id: 'a', name: 'Control board FL-7' },
  { id: 'b', name: 'Door lock' },
  { id: 'c', name: 'Drain pump' },
];

describe('filterParts', () => {
  it('returns everything for a blank query', () => {
    expect(filterParts(PARTS, '')).toEqual(PARTS);
    expect(filterParts(PARTS, '  ')).toEqual(PARTS);
  });

  it('matches a substring, case-insensitively', () => {
    expect(filterParts(PARTS, 'pump')).toEqual([PARTS[2]]);
    expect(filterParts(PARTS, ' DOOR ')).toEqual([PARTS[1]]);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterParts(PARTS, 'zzz')).toEqual([]);
  });

  it('keeps the server order', () => {
    expect(filterParts(PARTS, 'o').map((p) => p.id)).toEqual(['a', 'b']);
  });
});

describe('buildPartRequest', () => {
  it('is null until something is selected', () => {
    expect(buildPartRequest(null, '', '')).toBeNull();
  });

  it('sends a picked part by id', () => {
    expect(buildPartRequest('c', '', '')).toEqual({
      sparePartId: 'c',
      otherName: null,
      note: null,
    });
  });

  it('trims the note and drops a blank one', () => {
    expect(buildPartRequest('c', '', '  x  ')?.note).toBe('x');
    expect(buildPartRequest('c', '', '   ')?.note).toBeNull();
  });

  it('needs a name for Other', () => {
    expect(buildPartRequest(OTHER, '', '')).toBeNull();
    expect(buildPartRequest(OTHER, '   ', '')).toBeNull();
  });

  it('sends a trimmed typed name for Other', () => {
    expect(buildPartRequest(OTHER, ' clamp ', '')).toEqual({
      sparePartId: null,
      otherName: 'clamp',
      note: null,
    });
  });

  it('refuses an over-long name or note', () => {
    expect(buildPartRequest(OTHER, 'x'.repeat(MAX_OTHER), '')).not.toBeNull();
    expect(buildPartRequest(OTHER, 'x'.repeat(MAX_OTHER + 1), '')).toBeNull();
    expect(buildPartRequest('c', '', 'x'.repeat(MAX_NOTE))).not.toBeNull();
    expect(buildPartRequest('c', '', 'x'.repeat(MAX_NOTE + 1))).toBeNull();
  });

  it('ignores a stale typed name once a listed part is chosen', () => {
    expect(buildPartRequest('c', 'leftover', '')?.otherName).toBeNull();
  });
});

describe('wasAlreadyRequested', () => {
  const req = (id: string) => ({ id }) as PartRequest;

  it('is true when the same requests came back (the 200)', () => {
    expect(wasAlreadyRequested([req('1'), req('2')], [req('2'), req('1')])).toBe(true);
    expect(wasAlreadyRequested([], [])).toBe(true);
  });

  it('is false when a new request appeared', () => {
    expect(wasAlreadyRequested([req('1')], [req('1'), req('2')])).toBe(false);
    expect(wasAlreadyRequested([], [req('1')])).toBe(false);
  });
});
