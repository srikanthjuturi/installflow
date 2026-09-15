import { NativeModules } from 'react-native';

import { CLARITY_ENABLED, CLARITY_PROJECT_ID } from '@/lib/analytics/config';

/**
 * Microsoft Clarity — UX-friction diagnosis (session replay, rage taps).
 * Automatic once initialized; beyond `initialize` this app only tags the
 * screen name and the technician so a recording can be found again.
 *
 * Loaded lazily, and only when its native module is present. The package
 * builds a `NativeEventEmitter` from that module at IMPORT time, which throws
 * on iOS when it is missing — so a static import crashed Expo Go on launch —
 * and its own availability check tests for `null` where a missing module is
 * `undefined`, so `initialize` would throw on Android too.
 *
 * Nothing here masks anything: the RN SDK has no masking API. Masking is the
 * Clarity project's own setting, and this app shows customer names, phones,
 * addresses and UPI ids, so that project must be on Strict.
 */
type ClarityModule = typeof import('@microsoft/react-native-clarity');

const Clarity: ClarityModule | null =
  CLARITY_ENABLED && NativeModules.Clarity
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('@microsoft/react-native-clarity') as ClarityModule)
    : null;

export function initializeClarity(): void {
  Clarity?.initialize(CLARITY_PROJECT_ID);
}

/** Tag the session with the route, so a recording can be found by "where". */
export function setClarityScreenName(name: string): void {
  void Clarity?.setCurrentScreenName(name).catch(() => {});
}

/** Clarity has no `reset` to pair with this — a session ends and the next starts untagged. */
export function identifyClarity(technicianId: string): void {
  void Clarity?.setCustomUserId(technicianId).catch(() => {});
}
