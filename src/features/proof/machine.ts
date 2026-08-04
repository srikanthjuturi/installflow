import type { ProofKind } from '@/types/domain';

/**
 * The four proof artifacts, in the order the prototype captures them.
 * Barcode first because it's the fastest to fail — if the technician is at the
 * wrong unit, better to find out before photographing the whole install.
 */
export const PROOF_STEPS: ProofKind[] = ['barcode', 'serial', 'photos', 'live'];

export const MAX_PHOTOS = 4;
export const MIN_PHOTOS = 1;

export interface StepConfig {
  title: string;
  hint: string;
  /** Shown on the review tile. */
  reviewLabel: string;
}

export const STEP_CONFIG: Record<ProofKind, StepConfig> = {
  barcode: {
    title: 'Scan barcode',
    hint: 'Align the product barcode within the frame',
    reviewLabel: 'Barcode image',
  },
  serial: {
    title: 'Serial number',
    hint: 'Fill the box with the serial-number label',
    reviewLabel: 'Serial number',
  },
  photos: {
    title: 'Product photos',
    hint: 'Capture the installed unit from 2–3 angles',
    reviewLabel: 'Product photos',
  },
  live: {
    // Doc §8: gallery uploads are never accepted. Saying so on the capture
    // screen is cheaper than rejecting the submission afterwards.
    title: 'Live site photo',
    hint: 'On-site live capture · gallery uploads not accepted',
    reviewLabel: 'Geo-tagged live photos',
  },
};

export function stepNumber(step: ProofKind): number {
  return PROOF_STEPS.indexOf(step) + 1;
}

export function stepLabel(step: ProofKind): string {
  return `Step ${stepNumber(step)} of ${PROOF_STEPS.length}`;
}

export function nextStep(step: ProofKind): ProofKind | null {
  const i = PROOF_STEPS.indexOf(step);
  return PROOF_STEPS[i + 1] ?? null;
}
