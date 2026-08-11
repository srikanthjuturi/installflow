import { useQuery } from '@tanstack/react-query';

import { fetchMyProfile } from '@/features/auth/api/session';
import { qk } from '@/lib/queryKeys';
import { useProfileStore } from '@/store/profile.store';
import { useSession } from '@/store/session.store';

/**
 * The signed-in technician, from the server.
 *
 * Hard rule 3 — this is server state, so TanStack owns it. The session store
 * keeps a copy only because something has to be true on the first frame after
 * a cold start, before any request can finish; it is a seed, not the source.
 *
 * That seed is passed as `initialData` so the Profile tab paints immediately
 * instead of showing a skeleton for data the app already has, and
 * `initialDataUpdatedAt: 0` marks it as arbitrarily old so a refetch starts
 * anyway. A manager changing someone's pincodes, cap or status is exactly the
 * kind of edit that must not wait for the next sign-in to show up.
 */
export function useMe() {
  const seed = useSession((s) => s.technician);

  return useQuery({
    queryKey: qk.me(),
    queryFn: async () => {
      const me = await fetchMyProfile();

      // Refresh the seed so the NEXT cold start opens on current data.
      useSession.getState().setTechnician(me);

      // The avatar reads the profile store, which until now only ever held a
      // photo picked on this device. Seeding it from the server is what makes
      // a technician onboarded by a manager see their own face rather than
      // their initials. A local pick already in the store wins — it is newer,
      // and overwriting it would undo a change in front of the user.
      const { avatarUri, setAvatar } = useProfileStore.getState();
      if (me.profileImageUrl && !avatarUri) setAvatar(me.profileImageUrl);

      return me;
    },
    initialData: seed ?? undefined,
    initialDataUpdatedAt: 0,
    // Cheap and small; the Profile tab is also where someone looks to check
    // whether a change has landed, so a stale-on-focus refetch is wanted.
    staleTime: 30_000,
  });
}
