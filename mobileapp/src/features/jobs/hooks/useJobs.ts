import { useQuery } from '@tanstack/react-query';

import { getJob, getOffer, listMine, listPool, listToday } from '@/features/jobs/api/jobs';
import { qk } from '@/lib/queryKeys';
import { useAcceptingWork } from '@/features/availability/hooks/useAvailability';
import { useStreamConnected } from '@/store/realtime.store';
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
 * The same timer once the live stream is up — a backstop, not the mechanism.
 *
 * With `usePoolStream` connected the pool arrives the instant a ticket is
 * raised, so polling this fast is pure waste. It is not switched OFF, though,
 * and that is the important part: a websocket that has silently died looks
 * exactly like a pool where nothing is happening. A carrier can drop an idle
 * NAT mapping, a captive portal can swallow frames, an OS can freeze a socket
 * on a dozing device — in every one of those the app believes it is live and
 * would sit on a stale screen forever.
 *
 * Two minutes is the answer to "how long may a technician be wrong if the
 * stream lies to us", and it costs one indexed query per phone per two
 * minutes to guarantee it.
 */
const POOL_BACKSTOP_POLL_MS = 120_000;

/**
 * The open pool, kept current without anyone pulling to refresh.
 *
 * Four things make that true and all four are needed:
 *
 *  - `usePoolStream`, mounted once in `app/(app)/_layout.tsx`, which pushes a
 *    `pool.changed` the moment a ticket is raised and invalidates this query.
 *    That is what makes the pool feel instant rather than eventual;
 *  - `refetchInterval` while the screen is open — slowed to a backstop, not
 *    removed, once the stream is up. See POOL_BACKSTOP_POLL_MS;
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
  const online = useAcceptingWork();
  const streamed = useStreamConnected();

  return useQuery({
    queryKey: qk.pool(),
    queryFn: listPool,
    enabled: online,
    refetchInterval: online ? (streamed ? POOL_BACKSTOP_POLL_MS : POOL_POLL_MS) : false,
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
