import { t } from 'i18next';

import type { ProofKind } from '@/types/domain';

/**
 * The four proof artifacts, in the order the prototype captures them.
 * Barcode first because it's the fastest to fail — if the technician is at the
 * wrong unit, better to find out before photographing the whole install.
 */
export const PROOF_STEPS: ProofKind[] = ['barcode', 'serial', 'photos', 'live'];

/**
 * The steps actually walked on this visit.
 *
 * `serial` is CONDITIONAL. The barcode carries the serial number, so when it
 * scans there is nothing left for that step to establish — photographing the
 * label as well would be a step that proves something already proved. It
 * appears only when the barcode would not read, and then it asks for both the
 * label and the number typed by hand.
 */
export function stepsFor(scanned: boolean): ProofKind[] {
  return scanned ? PROOF_STEPS.filter((s) => s !== 'serial') : PROOF_STEPS;
}

export const MAX_PHOTOS = 4;
export const MIN_PHOTOS = 1;

/**
 * A suggestion, not a requirement — `photos` still accepts 1–4 shots in
 * whatever order the technician takes them. One entry per slot in
 * `MAX_PHOTOS`, so the key for the shot about to be taken is
 * `PHOTO_ANGLE_KEYS[photos.length]`.
 */
export const PHOTO_ANGLE_KEYS = [
  'proof.capture.angles.front',
  'proof.capture.angles.back',
  'proof.capture.angles.leftSide',
  'proof.capture.angles.rightSide',
] as const;

export type PhotoAngleKey = (typeof PHOTO_ANGLE_KEYS)[number];

/** Null once every suggested angle has been offered (`photosTaken >= MAX_PHOTOS`). */
export function suggestedAngleKey(photosTaken: number): PhotoAngleKey | null {
  return PHOTO_ANGLE_KEYS[photosTaken] ?? null;
}

/** Keys into the locale files, worded where they are shown — `t(config.title)`. */
export interface StepConfig {
  title: string;
  hint: string;
  /** Shown on the review tile. */
  reviewLabel: string;
}

export const STEP_CONFIG = {
  barcode: {
    title: 'proof.steps.barcode.title',
    hint: 'proof.steps.barcode.hint',
    reviewLabel: 'proof.steps.barcode.reviewLabel',
  },
  serial: {
    title: 'proof.steps.serial.title',
    // Reached only when the barcode would not scan, so the hint says what to
    // do about that rather than repeating the step's own title.
    hint: 'proof.steps.serial.hint',
    reviewLabel: 'proof.steps.serial.reviewLabel',
  },
  photos: {
    title: 'proof.steps.photos.title',
    hint: 'proof.steps.photos.hint',
    reviewLabel: 'proof.steps.photos.reviewLabel',
  },
  live: {
    // Doc §8: gallery uploads are never accepted. Saying so on the capture
    // screen is cheaper than rejecting the submission afterwards.
    title: 'proof.steps.live.title',
    hint: 'proof.steps.live.hint',
    reviewLabel: 'proof.steps.live.reviewLabel',
  },
} as const satisfies Record<ProofKind, StepConfig>;

export function stepNumber(step: ProofKind, steps: ProofKind[] = PROOF_STEPS): number {
  return steps.indexOf(step) + 1;
}

export function stepLabel(step: ProofKind, steps: ProofKind[] = PROOF_STEPS): string {
  return t('proof.stepOf', { n: stepNumber(step, steps), total: steps.length });
}

export function nextStep(
  step: ProofKind,
  steps: ProofKind[] = PROOF_STEPS,
): ProofKind | null {
  const i = steps.indexOf(step);
  return steps[i + 1] ?? null;
}

/** The step before this one, or null when already at the first. */
export function prevStep(
  step: ProofKind,
  steps: ProofKind[] = PROOF_STEPS,
): ProofKind | null {
  const i = steps.indexOf(step);
  return i > 0 ? (steps[i - 1] ?? null) : null;
}
