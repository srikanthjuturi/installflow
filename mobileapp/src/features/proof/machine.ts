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
    // Reached only when the barcode would not scan, so the hint says what to
    // do about that rather than repeating the step's own title.
    hint: 'Photograph the serial label, then type the number below',
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

export function stepNumber(step: ProofKind, steps: ProofKind[] = PROOF_STEPS): number {
  return steps.indexOf(step) + 1;
}

export function stepLabel(step: ProofKind, steps: ProofKind[] = PROOF_STEPS): string {
  return `Step ${stepNumber(step, steps)} of ${steps.length}`;
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
