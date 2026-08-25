import { create } from 'zustand';

/**
 * Whether the live pool stream is currently up.
 *
 * Client state, not server state — it describes this device's socket, not
 * anything the API holds — so hard rule 3 puts it here rather than in Query.
 *
 * It exists so the two halves can be written independently: `usePoolStream`
 * owns the socket and only ever writes this, `usePool` only ever reads it and
 * uses it to decide how hard to poll. Neither imports the other.
 */
interface RealtimeState {
  /** True between the server's `ready` frame and the socket closing. */
  streamConnected: boolean;
  setStreamConnected: (next: boolean) => void;
}

export const useRealtimeStore = create<RealtimeState>((set) => ({
  streamConnected: false,
  setStreamConnected: (streamConnected) => set({ streamConnected }),
}));

/** Read-only selector for screens and hooks that only care about the flag. */
export const useStreamConnected = () => useRealtimeStore((s) => s.streamConnected);
