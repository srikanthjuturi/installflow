import { NativeModule, requireOptionalNativeModule } from 'expo';

/** What Play knows about this phone's copy of the app. */
export interface PlayUpdateCheck {
  /** Play has a newer build this phone may download, and none is under way. */
  available: boolean;
  /** A newer build is already on the phone, waiting for `install`. */
  downloaded: boolean;
  /** The newer build's versionCode; 0 when Play has none. */
  versionCode: number;
}

type PlayUpdateEvents = {
  onDownloaded: () => void;
};

declare class PlayUpdateModule extends NativeModule<PlayUpdateEvents> {
  check(): Promise<PlayUpdateCheck>;
  /** Shows Play's sheet; true when the technician tapped Update. */
  start(): Promise<boolean>;
  /** Restarts into the downloaded build. */
  install(): Promise<void>;
}

/**
 * Null in Expo Go, on iOS and on web — Android only, and only in a native build.
 * Rejects on a build Play did not install (the dev client, the preview APK).
 */
export default requireOptionalNativeModule<PlayUpdateModule>('PlayUpdate');
