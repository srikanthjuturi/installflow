import { create } from 'zustand';

/**
 * Client state for the technician's own profile photo.
 *
 * Holds one of two things, and the difference matters:
 *  - a local `file://` path, straight out of the crop screen — OPTIMISTIC,
 *    only true on this device, and what registration still has to upload once
 *    a session exists;
 *  - the stored blob URL, once `POST /uploads` and `PATCH /auth/me` have both
 *    succeeded — the real value, mirrored here so the avatar paints without
 *    waiting for a query.
 *
 * In-memory, so it resets on reload; `useMe` reseeds it from the server.
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
