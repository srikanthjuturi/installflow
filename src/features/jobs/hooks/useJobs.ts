import { useQuery } from '@tanstack/react-query';

import { getJob, getOffer, listMine, listPool, listToday } from '@/features/jobs/api/jobs';
import { qk } from '@/lib/queryKeys';
import type { JobStatus } from '@/types/domain';

export function usePool() {
  return useQuery({ queryKey: qk.pool(), queryFn: listPool });
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
