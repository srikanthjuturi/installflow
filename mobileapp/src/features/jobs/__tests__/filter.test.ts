import { isSlotClosed, searchJobs, slotClosedCount } from '@/features/jobs/filter';
import type { Job } from '@/types/domain';

const NOW = Date.parse('2026-11-04T12:00:00Z');

/** A Job has far more fields than these helpers read; this is the slice they need. */
function makeJob(over: Partial<Job> = {}): Job {
  return {
    id: 'j1',
    code: 'RGT-INST-0001',
    category: 'Television',
    model: 'OLED 55',
    modelParameters: [],
    modelNotes: null,
    serviceType: 'Installation + Demo',
    area: 'Hyderabad',
    pincode: '500001',
    slotStart: null,
    slotEnd: null,
    status: 'upcoming',
    serverStatus: 'Assigned',
    hoursToSlot: null,
    maskedCustomer: 'Customer near 500001',
    customer: 'Ravi Kumar',
    ...over,
  } as unknown as Job;
}

describe('isSlotClosed', () => {
  it('is true for an upcoming job whose slot ended in the past', () => {
    const job = makeJob({
      status: 'upcoming',
      serverStatus: 'Assigned',
      slotStart: '2026-11-04T10:00:00.000Z',
      slotEnd: '2026-11-04T11:00:00.000Z',
    });
    expect(isSlotClosed(job, NOW)).toBe(true);
  });

  it('is false for an upcoming job whose slot is still ahead', () => {
    const job = makeJob({
      status: 'upcoming',
      serverStatus: 'Assigned',
      slotStart: '2026-11-05T10:00:00.000Z',
      slotEnd: '2026-11-05T11:00:00.000Z',
    });
    expect(isSlotClosed(job, NOW)).toBe(false);
  });
});

describe('slotClosedCount', () => {
  it('counts only the jobs whose slot has already closed', () => {
    const closed = makeJob({
      id: 'closed',
      slotStart: '2026-11-04T09:00:00.000Z',
      slotEnd: '2026-11-04T10:00:00.000Z',
    });
    const open = makeJob({
      id: 'open',
      slotStart: '2026-11-05T09:00:00.000Z',
      slotEnd: '2026-11-05T10:00:00.000Z',
    });
    const inProgress = makeJob({ id: 'inprogress', status: 'inprogress', serverStatus: 'In Progress' });

    expect(slotClosedCount([closed, open, inProgress], NOW)).toBe(1);
  });
});

describe('searchJobs', () => {
  const jobs = [
    makeJob({ id: 'a', code: 'RGT-INST-0001', customer: 'Ravi Kumar', pincode: '500001' }),
    makeJob({ id: 'b', code: 'RGT-INST-0002', customer: 'Sunita Reddy', pincode: '500081' }),
  ];

  it('returns every job for a blank query', () => {
    expect(searchJobs(jobs, '')).toEqual(jobs);
    expect(searchJobs(jobs, '   ')).toEqual(jobs);
  });

  it('matches on the ticket code, case-insensitively', () => {
    expect(searchJobs(jobs, 'inst-0002')).toEqual([jobs[1]]);
  });

  it('matches on the customer name, case-insensitively', () => {
    expect(searchJobs(jobs, 'ravi')).toEqual([jobs[0]]);
  });

  it('matches on the pincode', () => {
    expect(searchJobs(jobs, '500081')).toEqual([jobs[1]]);
  });

  it('returns nothing for a needle that matches no job', () => {
    expect(searchJobs(jobs, 'nobody-here')).toEqual([]);
  });
});
