import { useCallback, useState } from 'react';
import type { RefreshControlProps } from 'react-native';

import { color } from '@/theme/semantic';

type PullProps = Pick<RefreshControlProps, 'refreshing' | 'onRefresh' | 'tintColor' | 'colors'>;

/**
 * Pull-to-refresh, spread straight onto a `RefreshControl`:
 *
 *   const pull = usePullToRefresh(refetch);
 *   <ScrollView refreshControl={<RefreshControl {...pull} />}>
 *
 * The spinner runs for exactly as long as the technician's own pull is being
 * answered — not for the query's background refetches. Tying it to
 * `isRefetching` / `isFetching`, as the first screens did, lit it up on its own
 * every time the pool polled or a push invalidated `me`, which reads as the
 * app doing something nobody asked for; and Home tied it to only ONE of the two
 * lists it refreshes, so it stopped while the other was still loading.
 *
 * `refresh` should resolve when everything the screen shows has been asked
 * again — `Promise.all` the refetches, or `refetchQueries` a prefix. TanStack's
 * refetches resolve rather than throw on failure, and the screen's own error
 * state shows that failure, so nothing here needs to catch it.
 */
export function usePullToRefresh(refresh: () => Promise<unknown>): PullProps {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void refresh().finally(() => setRefreshing(false));
  }, [refresh]);

  return {
    refreshing,
    onRefresh,
    // The action blue, on both platforms: iOS reads `tintColor`, Android the
    // first of `colors`.
    tintColor: color.actionBg,
    colors: [color.actionBg],
  };
}
