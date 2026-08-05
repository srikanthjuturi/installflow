import { create } from 'zustand';

import { MAX_PHOTOS } from '@/features/proof/machine';
import type { ProofKind } from '@/types/domain';

/**
 * The in-flight proof session.
 *
 * Client state, not server state: these captures exist only on the device
 * until the technician submits. Keeping them in Zustand rather than Query is
 * what will let the offline outbox pick them up later without a redesign —
 * the URIs are already local file paths.
 */
export interface CapturedShot {
  /** Local file URI from expo-camera. */
  uri: string;
  capturedAt: number;
}

interface CaptureState {
  jobId: string | null;
  step: ProofKind;
  barcode: CapturedShot | null;
  serial: CapturedShot | null;
  photos: CapturedShot[];
  live: CapturedShot | null;

  start: (jobId: string) => void;
  setStep: (step: ProofKind) => void;
  capture: (step: ProofKind, shot: CapturedShot) => void;
  clearStep: (step: ProofKind) => void;
  reset: () => void;
}

const EMPTY = {
  jobId: null,
  step: 'barcode' as ProofKind,
  barcode: null,
  serial: null,
  photos: [] as CapturedShot[],
  live: null,
};

export const useCaptureStore = create<CaptureState>((set) => ({
  ...EMPTY,

  start: (jobId) => set({ ...EMPTY, jobId }),
  setStep: (step) => set({ step }),

  capture: (step, shot) =>
    set((s) => {
      if (step === 'photos') {
        // Cap rather than reject — a technician tapping fast shouldn't get an
        // error, the extra shot just doesn't land.
        if (s.photos.length >= MAX_PHOTOS) return s;
        return { photos: [...s.photos, shot] };
      }
      return { [step]: shot } as Partial<CaptureState>;
    }),

  clearStep: (step) =>
    set(() => (step === 'photos' ? { photos: [] } : ({ [step]: null } as Partial<CaptureState>))),

  reset: () => set({ ...EMPTY }),
}));

/** True once every required artifact exists. */
export function isProofComplete(s: CaptureState): boolean {
  return !!s.barcode && !!s.serial && s.photos.length > 0 && !!s.live;
}
