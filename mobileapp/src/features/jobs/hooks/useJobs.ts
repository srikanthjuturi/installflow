import { useQuery } from '@tanstack/react-query';

import { getJob, getOffer, listMine, listPool, listToday } from '@/features/jobs/api/jobs';
import { qk } from '@/lib/queryKeys';
import { useAvailabilityStore } from '@/store/availability.store';
import type { JobStatus } from '@/types/domain';

/**
 * How often the pool re-asks while the technician is online and looking at it.
 *
 * Twenty seconds is a judgement, not a measurement: assignment is
 * first-accept-wins, so a stale pool is a job somebody else is taking, and the
 * cost of asking is one indexed query against a partial index built for it.
 * Much faster would spend a field technician's data for a list that changes
 * when a CUSTOMER confirms a slot — minutes apart, not seconds.
 */
const POOL_POLL_MS = 20_000;

/**
 * The open pool, kept current without anyone pulling to refresh.
 *
 * Three things make that true and all three are needed:
 *
 *  - `refetchInterval` while the screen is open;
 *  - `refetchOnWindowFocus`, which `useAppStateFocus` in `app/_layout.tsx`
 *    turns into "when the app comes back from the background" — the case that
 *    actually matters, since a phone spends most of its day in a pocket;
 *  - `refetchIntervalInBackground` left OFF (the default), so a backgrounded
 *    app stops asking entirely rather than draining the battery for a list
 *    nobody is reading.
 *
 * All of it is gated on the online toggle. "You're offline · Not receiving
 * offers" is a promise the screen makes; polling anyway would contradict it,
 * and would keep waking the radio for a technician who has finished for the day.
 */
export function usePool() {
  const online = useAvailabilityStore((s) => s.online);

  return useQuery({
    queryKey: qk.pool(),
    queryFn: listPool,
    enabled: online,
    refetchInterval: online ? POOL_POLL_MS : false,
    refetchOnWindowFocus: online,
    // Shorter than the 30s default: a value that outlives the poll interval
    // would make the interval a no-op, since a fresh query does not refetch.
    staleTime: 10_000,
  });
}

export function useOffer(id: string) {
  return useQuery({ queryKey: qk.poolOffer(id), queryFn: () => getOffer(id), enabled: !!id });
}

export function useMyJobs(status: JobStatus | 'all') {
  return useQuery({ queryKey: qk.myJobs(status), queryFn: () => listMine(status) });
}

export function useJob(id: string) {
  return useQuery({ queryKey: qk.job(id), queryFn: () => getJob(id), enabled: !!id });
}

export function useTodayJobs() {
  return useQuery({ queryKey: [...qk.myJobs('all'), 'today'], queryFn: listToday });
}
