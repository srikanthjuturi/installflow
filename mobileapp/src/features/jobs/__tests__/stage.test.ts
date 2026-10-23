import { jobActions, toJobStatus } from '@/features/jobs/stage';

/** A Job has more fields than `jobActions` looks at; this is the slice it reads. */
const base = { serverStatus: 'Assigned', hoursToSlot: 10 as number | null };

describe('toJobStatus', () => {
  it('maps every status the API sends today', () => {
    // The expected half is `JobStatus`, not `JobStage` — these are tab buckets,
    // not detail actions.
    const cases: [string, string][] = [
      ['New', 'pool'],
      ['Slot Pending', 'pool'],
      ['Assigned', 'upcoming'],
      ['In Progress', 'inprogress'],
      ['Awaiting Customer', 'inprogress'],
      ['Awaiting Part', 'inprogress'],
      ['Escalated', 'inprogress'],
      ['AI Review', 'inprogress'],
      ['Closed', 'completed'],
      ['Force-Closed', 'completed'],
      ['Cancelled', 'cancelled'],
    ];
    for (const [status, expected] of cases) {
      expect(toJobStatus(status)).toBe(expected);
    }
  });

  it('falls back to in-progress for a status this build has never heard of', () => {
    expect(toJobStatus('Something New')).toBe('inprogress');
    // Prototype shapes a plain bracket read would pick up on.
    expect(toJobStatus('constructor')).toBe('inprogress');
    expect(toJobStatus('__proto__')).toBe('inprogress');
  });

  it('falls back to in-progress when the status is absent', () => {
    expect(toJobStatus(undefined)).toBe('inprogress');
    expect(toJobStatus(null)).toBe('inprogress');
  });
});

describe('jobActions', () => {
  it('offers start on an assigned job with a confirmed slot', () => {
    const actions = jobActions({ ...base, hoursToSlot: 10 });
    expect(actions.stage).toBe('start');
    expect(actions.canCancel).toBe(true);
    expect(actions.canReschedule).toBe(true);
    expect(actions).not.toHaveProperty('complete');
  });

  it('waits for time confirmation on an assigned job with no slot', () => {
    const actions = jobActions({ ...base, hoursToSlot: null });
    expect(actions.stage).toBe('awaitingTime');
    expect(actions.canCancel).toBe(true);
    expect(actions.canReschedule).toBe(false);
  });

  it('offers complete on an in-progress job', () => {
    expect(jobActions({ ...base, serverStatus: 'In Progress' }).stage).toBe('complete');
  });

  it('awaits the customer on the confirmation stage', () => {
    expect(jobActions({ ...base, serverStatus: 'Awaiting Customer' }).stage).toBe('awaitingCustomer');
  });

  it('waits for a part — nothing to press until the part lands', () => {
    const actions = jobActions({ ...base, serverStatus: 'Awaiting Part' });
    expect(actions.stage).toBe('awaitingPart');
    expect(actions.canCancel).toBe(false);
    expect(actions.canReschedule).toBe(false);
  });

  it('escalates both Escalated and AI Review', () => {
    expect(jobActions({ ...base, serverStatus: 'Escalated' }).stage).toBe('escalated');
    expect(jobActions({ ...base, serverStatus: 'AI Review' }).stage).toBe('escalated');
  });

  it('reads the three terminal statuses as done', () => {
    for (const status of ['Closed', 'Force-Closed', 'Cancelled']) {
      expect(jobActions({ ...base, serverStatus: status }).stage).toBe('done');
    }
  });

  it('shows no actions on the pre-assignment statuses', () => {
    for (const status of ['New', 'Slot Pending', undefined]) {
      expect(jobActions({ ...base, serverStatus: status }).stage).toBe('none');
    }
  });

  it('renders an unknown status inert rather than guessing a Start button', () => {
    const actions = jobActions({ ...base, serverStatus: 'Something New' });
    expect(actions.stage).toBe('unknown');
    expect(actions.canCancel).toBe(false);
    expect(actions.canReschedule).toBe(false);
  });
});