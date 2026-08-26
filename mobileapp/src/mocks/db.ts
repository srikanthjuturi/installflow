import type {
  Availability,
  EarningsSummary,
  ProductCategory,
  Technician,
  Transaction,
} from '@/types/domain';

/**
 * Seeded mock dataset for the UI phase.
 *
 * Deterministic on purpose — stable demos, stable screenshots. The four jobs
 * carried over from the prototype (INST-4821 / 4830 / 4847 / 4790) are kept
 * verbatim as the demo path; the rest exist so pagination, every filter and
 * every empty state are actually reachable.
 *
 * Mutations write to this module's state, so accepting a job persists for the
 * session. It resets on reload — acceptable while there's no backend.
 */

export const CATEGORIES: ProductCategory[] = [
  'Television',
  'Washing Machine',
  'Refrigerator',
  'Air Conditioner',
  'Microwave',
  'Water Purifier',
];

export const technician: Technician = {
  id: 'TCH-4021',
  name: 'Rohit Kadam',
  phone: '+91 98765 43210',
  region: 'Mumbai — Suburban',
  onboardedBy: 'Reliance GreenTech · West Zone',
  rating: 4.8,
  jobsDone: 312,
  onTimePct: 96,
  categories: ['Television', 'Washing Machine'],
  pincodes: ['400067', '400097', '400104'],
};

export const availability: Availability = {
  days: { Mon: true, Tue: true, Wed: true, Thu: true, Fri: true, Sat: true, Sun: false },
  bandwidthPerDay: 6,
  timeOff: false,
};

/**
 * The seeded jobs are GONE.
 *
 * Eleven rows carrying fabricated customer names, addresses and phone
 * numbers, which the app rendered as though they were real work. They were
 * load-bearing while nothing served a technician their own jobs; now
 * `GET /jobs/mine`, `GET /jobs/{id}` and `GET /jobs/today` do, and a seeded
 * job is just a lie about somebody waiting at an address.
 *
 * What is still mock lives below — earnings and availability — because the
 * ledger does not exist and availability is half-bound. Those go the same
 * way when their slices land.
 */

export const transactions: Transaction[] = [
  {
    id: 'TXN-9001',
    kind: 'install',
    title: 'Install · Reliance GreenTech 55" QLED',
    subtitle: 'Today · INST-4788',
    amountPaise: 46000,
  },
  {
    id: 'TXN-9002',
    kind: 'bonus',
    title: 'Reassignment bonus',
    subtitle: 'Today · ASM escalation',
    amountPaise: 12000,
  },
  {
    id: 'TXN-9003',
    kind: 'install',
    title: 'Install · Reliance GreenTech 7kg WM',
    subtitle: 'Yesterday · INST-4771',
    amountPaise: 52000,
  },
  {
    id: 'TXN-9004',
    kind: 'penalty',
    title: 'Late cancellation penalty',
    subtitle: 'Yesterday · INST-4769',
    amountPaise: -15000,
  },
  {
    id: 'TXN-9005',
    kind: 'install',
    title: 'Install · Reliance GreenTech 43" LED',
    subtitle: 'Mon · INST-4752',
    amountPaise: 42000,
  },
  {
    id: 'TXN-9006',
    kind: 'install',
    title: 'Install · Reliance GreenTech 32" HD',
    subtitle: 'Mon · INST-4740',
    amountPaise: 38000,
  },
];

export const earnings: EarningsSummary = {
  netPaise: 175000,
  earnedPaise: 220000,
  bonusesPaise: 12000,
  penaltiesPaise: -15000,
};
