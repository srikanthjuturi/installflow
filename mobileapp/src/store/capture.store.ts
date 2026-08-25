import { create } from 'zustand';

import { MAX_PHOTOS } from '@/features/proof/machine';
import type { ProofKind } from '@/types/domain';

/**
 * The in-flight proof session.
 *
 * Client state, not server state: these captures exist only on the device until
 * the technician submits. Keeping them in Zustand rather than Query is what
 * will let an offline outbox pick them up later without a redesign — the URIs
 * are already local file paths.
 *
 * Each shot carries its own upload state, because the upload starts the moment
 * the shutter closes rather than at submit. A technician on a site with two
 * bars should not capture four artifacts and only then discover that nothing
 * left the phone.
 */
export interface Coords {
  latitude: number;
  longitude: number;
  /** Metres. A fix good to 2km is not the evidence a fix good to 5m is. */
  accuracy: number | null;
  /**
   * The postal code the DEVICE is actually standing in, reverse-geocoded from
   * the fix above.
   *
   * Emphatically not the ticket's pincode. The badge used to print the job's
   * pincode beside the words "Location locked", which reads as a confirmation
   * that the technician is at the address — a claim nothing was making. This is
   * the phone's own answer, and where the two disagree that is worth seeing.
   *
   * Null when reverse geocoding is unavailable or returns nothing; the
   * coordinates remain the exact record either way.
   */
  pincode?: string | null;
}

export type UploadState = 'pending' | 'uploading' | 'done' | 'failed';

export interface CapturedShot {
  /** Local file URI from expo-camera. Survives until the OS clears the cache. */
  uri: string;
  capturedAt: number;
  upload: UploadState;
  /**
   * What the server gave back — an opaque blob NAME, not a URL, because proof
   * lives in a private container. Null until the upload succeeds; a shot
   * without one cannot be submitted.
   */
  blobName: string | null;
  /** Meta's own words when it refused, so a retry can show why. */
  error?: string;
  /** Set on the `live` shot only. Null when location was denied or lost. */
  coords?: Coords | null;
}

interface CaptureState {
  jobId: string | null;
  step: ProofKind;
  /**
   * The serial found on site, and how.
   *
   * `scanned` comes off the barcode and is why the serial step can be skipped
   * — the number is already in hand, so photographing the label as well proves
   * nothing new. `manual` is typed by the technician when the barcode would
   * not read, and then the label photo IS required, because a typed number
   * with nothing behind it is only an assertion.
   */
  serialValue: string | null;
  serialSource: 'scanned' | 'manual' | null;
  barcode: CapturedShot | null;
  serial: CapturedShot | null;
  photos: CapturedShot[];
  live: CapturedShot | null;

  start: (jobId: string) => void;
  setStep: (step: ProofKind) => void;
  setSerial: (value: string | null, source: 'scanned' | 'manual' | null) => void;
  capture: (step: ProofKind, shot: CapturedShot) => void;
  /** Move one shot along its upload lifecycle, addressed by uri. */
  markUpload: (uri: string, patch: Partial<CapturedShot>) => void;
  /**
   * Drop ONE product photo.
   *
   * `clearStep('photos')` empties the whole array, which made "retake" on the
   * photos row destroy all four shots to fix one. This is the surgical version.
   */
  removePhoto: (uri: string) => void;
  clearStep: (step: ProofKind) => void;
  reset: () => void;
}

const EMPTY = {
  jobId: null,
  step: 'barcode' as ProofKind,
  serialValue: null as string | null,
  serialSource: null as 'scanned' | 'manual' | null,
  barcode: null,
  serial: null,
  photos: [] as CapturedShot[],
  live: null,
};

/** A shot as it exists the instant it is taken: on disk, not yet anywhere else. */
export function newShot(uri: string, coords?: Coords | null): CapturedShot {
  return { uri, capturedAt: Date.now(), upload: 'pending', blobName: null, coords };
}

export const useCaptureStore = create<CaptureState>((set) => ({
  ...EMPTY,

  start: (jobId) => set({ ...EMPTY, jobId }),
  setStep: (step) => set({ step }),
  setSerial: (serialValue, serialSource) => set({ serialValue, serialSource }),

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

  markUpload: (uri, patch) =>
    set((s) => {
      const apply = (shot: CapturedShot | null) =>
        shot && shot.uri === uri ? { ...shot, ...patch } : shot;
      return {
        barcode: apply(s.barcode),
        serial: apply(s.serial),
        live: apply(s.live),
        photos: s.photos.map((p) => (p.uri === uri ? { ...p, ...patch } : p)),
      };
    }),

  removePhoto: (uri) => set((s) => ({ photos: s.photos.filter((p) => p.uri !== uri) })),

  clearStep: (step) =>
    set(() => (step === 'photos' ? { photos: [] } : ({ [step]: null } as Partial<CaptureState>))),

  reset: () => set({ ...EMPTY }),
}));

/**
 * Every artifact this visit needs, captured.
 *
 * The serial PHOTO is required only when the barcode did not scan — see
 * `stepsFor`. A serial VALUE is always required, by one route or the other:
 * nobody leaves site without recording which unit they installed.
 */
export function isProofComplete(s: CaptureState): boolean {
  const serialPhotoNeeded = s.serialSource !== 'scanned';
  return (
    !!s.barcode &&
    !!s.serialValue &&
    (!serialPhotoNeeded || !!s.serial) &&
    s.photos.length > 0 &&
    !!s.live
  );
}

/** Every shot in one flat list, in the order the server expects them. */
export function allShots(s: CaptureState): { kind: ProofKind; shot: CapturedShot }[] {
  const out: { kind: ProofKind; shot: CapturedShot }[] = [];
  if (s.barcode) out.push({ kind: 'barcode', shot: s.barcode });
  if (s.serial) out.push({ kind: 'serial', shot: s.serial });
  s.photos.forEach((shot) => out.push({ kind: 'photos', shot }));
  if (s.live) out.push({ kind: 'live', shot: s.live });
  return out;
}

/**
 * Ready to submit: captured AND every image actually in blob storage.
 *
 * Deliberately stricter than `isProofComplete`. The submit call sends blob
 * names, so a shot that is still uploading has nothing to send — enabling the
 * button on capture alone would produce a 400 from the server and look like the
 * app's fault.
 */
export function isProofUploaded(s: CaptureState): boolean {
  return isProofComplete(s) && allShots(s).every(({ shot }) => !!shot.blobName);
}
