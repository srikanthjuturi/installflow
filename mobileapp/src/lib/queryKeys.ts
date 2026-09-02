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

  // The window is part of the key, not just the request: a week, a month and a
  // range somebody picked are three different answers, and sharing one entry
  // would show the reader the last one's figures for a beat every time they
  // switched. `windowQuery` builds both the key and the query string, so the
  // two cannot drift.
  earningsSummary: (window: string) => ['earnings', 'summary', window] as const,
  transactions: (window: string) => ['earnings', 'transactions', window] as const,
  /**
   * Every earnings answer, whatever window it was asked over.
   *
   * What an invalidation has to use. A penalty lands in the week AND the month
   * AND whatever span the technician happens to be looking at, so naming one
   * window would leave the other entries showing figures from before the money
   * moved — which is exactly what invalidating `earningsSummary()` on its
   * default did.
   */
  earnings: () => ['earnings'] as const,

  categories: () => ['catalog', 'categories'] as const,
} as const;
