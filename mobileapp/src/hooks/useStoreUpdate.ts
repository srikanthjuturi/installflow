import { useEffect } from 'react';
import { AppState } from 'react-native';

import { trackAppUpdateOffered } from '@/lib/analytics/events';
import { allShots, useCaptureStore } from '@/store/capture.store';

import PlayUpdate from '../../modules/play-update';

/**
 * "Update available" — Google Play's own sheet, not ours.
 *
 * Play draws it over the app with Update and a close button, in the phone's
 * language, so it needs no copy and no translations; and it hears of a release
 * the moment Play does, so nothing here or on the server is told a version.
 *
 * FLEXIBLE: Update downloads in the background while the technician carries on.
 * The new build then waits on the phone, and installing it RESTARTS the app —
 * which is why it is installed only when the app is in the BACKGROUND and no
 * proof shots are waiting to be submitted. `capture.store` lives only in memory,
 * so a restart mid-proof would throw away every shot; a restart in the
 * background is silent, and the next time the app opens it is the new version.
 *
 * Never forced. Closing the sheet carries on into the app: a technician at a
 * customer's door on two bars of signal must still be able to start the job.
 * They are asked again at the next launch, or as soon as a newer version
 * reaches Play — not at every app switch, which only a version not yet offered
 * in this run triggers.
 *
 * Play-installed builds only. Play refuses to answer for an APK it did not
 * install — the dev client, the preview build — and that refusal is swallowed.
 * The module itself is `modules/play-update`, null in Expo Go and on iOS.
 */
const Play = __DEV__ ? null : PlayUpdate;

/** The Play `versionCode` already offered in this run of the app. */
let offeredVersion: number | null = null;
/** Launch and the first `active` event can arrive together; ask Play once. */
let checking = false;
/** A newer build is on the phone, waiting for a safe moment to install. */
let downloaded = false;

const hasUnsavedProof = () => allShots(useCaptureStore.getState()).length > 0;

async function offerUpdate(): Promise<void> {
  if (!Play || checking) return;

  checking = true;
  try {
    const play = await Play.check();
    downloaded = play.downloaded;
    if (!play.available || play.versionCode === offeredVersion) return;
    // A sheet over the camera at the customer's door is noise; it comes back
    // at the next return to the app once the proof is in.
    if (hasUnsavedProof()) return;

    offeredVersion = play.versionCode;
    trackAppUpdateOffered(play.versionCode);
    await Play.start();
  } catch {
    // Not installed from Play, no Play Store on the phone, offline — nothing
    // the technician can act on, and the app works as it is.
  } finally {
    checking = false;
  }
}

function installIfAway(): void {
  if (!Play || !downloaded) return;
  if (AppState.currentState !== 'background' || hasUnsavedProof()) return;
  Play.install().catch(() => {});
}

/** Offers and installs a newer Play Store release. Mounted once, in the root layout. */
export function useStoreUpdate(ready: boolean): void {
  useEffect(() => {
    if (!ready || !Play) return;

    void offerUpdate();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void offerUpdate();
      else if (state === 'background') installIfAway();
    });
    const download = Play.addListener('onDownloaded', () => {
      downloaded = true;
      installIfAway();
    });
    return () => {
      appState.remove();
      download.remove();
    };
  }, [ready]);
}
