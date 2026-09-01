import type { JobStatus } from '@/types/domain';

/**
 * Central query key registry.
 *
 * Keys are shaped like the eventual REST paths, so when the Python backend
 * lands each queryFn swaps to a request against the matching endpoint and the
 * cache topology stays exactly as it is.
 */
export const qk = {
  invite: (token: string) => ['auth', 'invite', token] as const,
  me: () => ['me'] as const,

  pool: () => ['jobs', 'pool'] as const,
  poolOffer: (id: string) => ['jobs', 'pool', id] as const,
  myJobs: (status: JobStatus | 'all') => ['jobs', 'mine', status] as const,
  job: (id: string) => ['jobs', id] as const,
  cancellationPreview: (id: string) => ['jobs', id, 'cancellation-preview'] as const,

  // The period is part of the key, not just the request: a week and a month
  // are two different answers, and sharing one entry would show the reader
  // last period's figures for a beat every time they switched.
  earningsSummary: (period: string = 'week') =>
    ['earnings', 'summary', period] as const,
  transactions: (period: string = 'week') =>
    ['earnings', 'transactions', period] as const,

  categories: () => ['catalog', 'categories'] as const,
} as const;
