import {
  DEFAULT_MIN_GAP_SECONDS,
  classifyFailure,
  isSharingStatus,
  shouldSend,
  shouldWatch,
  showDeniedNote,
  type WatchInputs,
} from '@/features/jobs/shareLocation';
import { ApiError } from '@/lib/api';

const ok: WatchInputs = {
  status: 'In Progress',
  appActive: true,
  signedIn: true,
  permission: 'granted',
  stoppedByServer: false,
};

describe('isSharingStatus', () => {
  it('is true for exactly the three active statuses', () => {
    for (const s of ['Assigned', 'In Progress', 'Awaiting Part']) expect(isSharingStatus(s)).toBe(true);
    for (const s of ['New', 'Slot Pending', 'Awaiting Customer', 'Escalated', 'Closed', 'Force-Closed', 'Cancelled', 'Whatever', '', undefined, null]) {
      expect(isSharingStatus(s)).toBe(false);
    }
  });
});

describe('shouldWatch', () => {
  it('runs when everything lines up', () => {
    expect(shouldWatch(ok)).toBe(true);
    expect(shouldWatch({ ...ok, status: 'Assigned' })).toBe(true);
    expect(shouldWatch({ ...ok, status: 'Awaiting Part' })).toBe(true);
  });
  it.each([
    ['backgrounded', { appActive: false }],
    ['signed out', { signedIn: false }],
    ['permission denied', { permission: 'denied' as const }],
    ['permission unknown', { permission: 'unknown' as const }],
    ['server said stop', { stoppedByServer: true }],
    ['job closed', { status: 'Closed' }],
    ['status not loaded', { status: undefined }],
  ])('does not run when %s', (_n, patch) => {
    expect(shouldWatch({ ...ok, ...patch })).toBe(false);
  });
});

describe('showDeniedNote', () => {
  it('shows only for an active job whose permission was denied', () => {
    expect(showDeniedNote({ ...ok, permission: 'denied' })).toBe(true);
    expect(showDeniedNote(ok)).toBe(false);
    expect(showDeniedNote({ ...ok, permission: 'denied', status: 'Closed' })).toBe(false);
    expect(showDeniedNote({ ...ok, permission: 'denied', appActive: false })).toBe(false);
  });
});

describe('shouldSend', () => {
  it('sends the first fix', () => {
    expect(shouldSend(1000, null)).toBe(true);
  });
  it('waits for the default gap', () => {
    const gap = DEFAULT_MIN_GAP_SECONDS * 1000;
    expect(shouldSend(1000 + gap - 1, 1000)).toBe(false);
    expect(shouldSend(1000 + gap, 1000)).toBe(true);
  });
  it('honours the server figure', () => {
    expect(shouldSend(1000 + 14_999, 1000, 15)).toBe(false);
    expect(shouldSend(1000 + 15_000, 1000, 15)).toBe(true);
    expect(shouldSend(1000 + 40_000, 1000, 60)).toBe(false);
  });
  it('falls back to the default for a nonsense figure', () => {
    expect(shouldSend(1000 + 5_000, 1000, 0)).toBe(false);
    expect(shouldSend(1000 + 5_000, 1000, NaN)).toBe(false);
    expect(shouldSend(1000 + 20_000, 1000, -3)).toBe(true);
  });
});

describe('classifyFailure', () => {
  it('stops on 409 JOB_NOT_ACTIVE and on 404', () => {
    expect(classifyFailure(new ApiError('x', 409, [], 'JOB_NOT_ACTIVE'))).toBe('stop');
    expect(classifyFailure(new ApiError('x', 404))).toBe('stop');
  });
  it('drops everything else', () => {
    expect(classifyFailure(new ApiError('x', 409, [], 'OTHER'))).toBe('drop');
    expect(classifyFailure(new ApiError('x', 409))).toBe('drop');
    expect(classifyFailure(new ApiError('x', 422))).toBe('drop');
    expect(classifyFailure(new ApiError('x', 500))).toBe('drop');
    expect(classifyFailure(new ApiError('x', 0, [], 'OFFLINE'))).toBe('drop');
    expect(classifyFailure(new Error('boom'))).toBe('drop');
    expect(classifyFailure(undefined)).toBe('drop');
  });
});
