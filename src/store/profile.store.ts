import { create } from 'zustand';

/**
 * Client state for the technician's own profile photo.
 *
 * The URI is a local file path from the picker. It lives here rather than in
 * TanStack Query because until it's uploaded it isn't server state at all —
 * and keeping it as a file path is what will let the offline outbox pick it
 * up later, the same way proof captures work.
 *
 * UI phase: in-memory, so it resets on reload. Binding phase adds
 * `POST /me/avatar` and this becomes the optimistic value while it uploads.
 */
interface ProfileState {
  avatarUri: string | null;
  setAvatar: (uri: string) => void;
  clearAvatar: () => void;
}

export const useProfileStore = create<ProfileState>((set) => ({
  avatarUri: null,
  setAvatar: (avatarUri) => set({ avatarUri }),
  clearAvatar: () => set({ avatarUri: null }),
}));
