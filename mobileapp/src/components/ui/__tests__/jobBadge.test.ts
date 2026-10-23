import { jobBadge } from '../jobBadge';

/** Fixed "now" so slot-distance branches are deterministic. */
const NOW = new Date('2026-10-22T10:00:00+05:30').getTime();
const HOUR = 3_600_000;

const slot = (startMs: number, endMs: number) => ({
  slotStart: new Date(startMs).toISOString(),
  slotEnd: new Date(endMs).toISOString(),
});

const NO_SLOT = { slotStart: '', slotEnd: '' };

describe('jobBadge', () => {
  it('shows the awaiting-part badge even when the slot has closed — nothing else', () => {
    // Past the slot end, the generic in-progress branch would read "Slot
    // closed"; the part badge has to win over it.
    const badge = jobBadge(
      { status: 'inprogress', serverStatus: 'Awaiting Part', ...slot(NOW - 6 * HOUR, NOW - 1 * HOUR) },
      NOW,
    );
    expect(badge.label).toBe('awaitingPart');
    expect(badge.fg).not.toBe('');
    expect(badge.bg).not.toBe('');
  });

  it('keeps the generic in-progress badge for a plain in-progress job', () => {
    const badge = jobBadge({ status: 'inprogress', ...slot(NOW + 1 * HOUR, NOW + 3 * HOUR) }, NOW);
    expect(badge.label).toBe('inProgress');
  });

  it('shows cancelled/completed over everything else', () => {
    expect(jobBadge({ status: 'cancelled', ...NO_SLOT }, NOW).label).toBe('cancelled');
    expect(jobBadge({ status: 'completed', ...NO_SLOT }, NOW).label).toBe('completed');
    expect(
      jobBadge({ status: 'completed', serverStatus: 'Awaiting Part', ...NO_SLOT }, NOW).label,
    ).toBe('completed');
  });

  it('reads a job with no slot yet as awaiting time', () => {
    expect(jobBadge({ status: 'upcoming', ...NO_SLOT }, NOW).label).toBe('awaitingTime');
  });

  it('reads a closed slot on an unstarted job as slot closed', () => {
    expect(jobBadge({ status: 'upcoming', ...slot(NOW - 6 * HOUR, NOW - 1 * HOUR) }, NOW).label).toBe(
      'slotClosed',
    );
  });

  it('reads a slot within four hours as starting soon', () => {
    expect(jobBadge({ status: 'upcoming', ...slot(NOW + 2 * HOUR, NOW + 4 * HOUR) }, NOW).label).toBe(
      'startingSoon',
    );
  });

  it('reads a slot further out as upcoming', () => {
    expect(jobBadge({ status: 'upcoming', ...slot(NOW + 12 * HOUR, NOW + 14 * HOUR) }, NOW).label).toBe(
      'upcoming',
    );
  });
});