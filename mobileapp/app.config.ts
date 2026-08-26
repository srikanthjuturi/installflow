import { existsSync } from 'node:fs';

import type { ExpoConfig } from 'expo/config';

// Colours are duplicated as literals ONLY here: app.config.ts is evaluated by
// the Expo CLI before Metro exists, so it cannot resolve the `@/` alias.
// Values must stay in sync with src/theme/tokens.js.
const INK = '#141b22';
const SURFACE = '#eef1f3';

/**
 * The host that serves invite links, taken from the API URL so there is exactly
 * ONE place to change it.
 *
 * It is compiled into the Android intent filter below, which is what lets a
 * WhatsApp invite open the app directly instead of a browser — so a change of
 * hostname needs a new build.
 *
 * EVERY eas.json build profile must set EXPO_PUBLIC_API_URL. `.env` is
 * gitignored and there is no .easignore, so EAS never uploads it: a profile
 * that omits the variable builds an app with NO intent filter and an API base
 * URL of localhost. Both fail silently — the app simply cannot reach anything
 * and invite links quietly open a browser. The production profile shipped in
 * exactly that state until it was caught.
 */
function inviteHost(): string | undefined {
  const api = process.env.EXPO_PUBLIC_API_URL;
  if (!api) return undefined;
  try {
    return new URL(api).host;
  } catch {
    return undefined;
  }
}

const INVITE_HOST = inviteHost();

const config: ExpoConfig = {
  name: 'Reliance GreenTech Technician',
  // NOT the product name, and never shown to a technician — `name` above is
  // what appears under the launcher icon. Deliberately still the pre-rebrand
  // value: an Expo project's slug is fixed at creation, so renaming it here
  // would mean a NEW project, a new projectId and fresh credentials — hence a
  // new signing keystore, which would invalidate the SHA-256 already published
  // in the API's assetlinks.json and silently break every App Link.
  slug: 'videocon-technician',
  owner: 'srikanth24',
  scheme: 'reliancegreentech', // invite deep links: reliancegreentech://invite/<token>
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light', // no dark mode in v1 — outdoor legibility
  newArchEnabled: true,
  icon: './assets/icon.png',
  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: INK,
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.reliancegreentech.technician',
  },
  android: {
    package: 'com.reliancegreentech.technician',
    // FCM credentials for push. Referenced only when the file is present, so a
    // clone without it still runs — `expo start` and Expo Go do not need it,
    // and a hard reference to a missing path fails the config outright rather
    // than the one command that actually needs it.
    //
    // This package name must match the Android app registered in Firebase
    // character for character. A mismatch does not error anywhere: FCM simply
    // accepts the send and never delivers it.
    ...(existsSync('./google-services.json')
      ? { googleServicesFile: './google-services.json' }
      : {}),
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: INK,
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    // Inert while edgeToEdgeEnabled is on — the app draws behind the IME, so
    // the window does NOT resize for the keyboard and this setting has nothing
    // to act on. Keyboard avoidance is done in JS instead; see
    // src/components/layout/KeyboardFlow.tsx. Kept at the default so that
    // turning edge-to-edge off restores resizing rather than panning — but
    // KeyboardFlow's `behavior` would then need revisiting, or the keyboard
    // gets subtracted twice.
    softwareKeyboardLayoutMode: 'resize',
    // Android App Link. `autoVerify` makes Android fetch
    // https://<host>/.well-known/assetlinks.json AT INSTALL TIME and, if it
    // names this package and signing certificate, hand the link straight to the
    // app — so a technician taps the invite in WhatsApp and lands on the invite
    // screen, with no browser page in between.
    //
    // Omitted entirely when the host is unknown: an intent filter with no host
    // would claim every https link on the device.
    ...(INVITE_HOST
      ? {
          intentFilters: [
            {
              action: 'VIEW',
              autoVerify: true,
              category: ['BROWSABLE', 'DEFAULT'],
              data: [{ scheme: 'https', host: INVITE_HOST, pathPrefix: '/invite' }],
            },
          ],
        }
      : {}),
  },
  web: {
    favicon: './assets/favicon.png',
    bundler: 'metro',
  },
  plugins: [
    'expo-router',
    'expo-font',
    [
      'expo-notifications',
      {
        color: INK,
        // Android draws the status-bar icon as a flat silhouette and falls back
        // to a featureless white square without a purpose-made asset. Wired
        // conditionally so dropping `notification-icon.png` in picks it up —
        // naming a file that is not there fails the config outright, and an
        // ugly icon is a smaller problem than a build that will not run.
        ...(existsSync('./assets/notification-icon.png')
          ? { icon: './assets/notification-icon.png' }
          : {}),
        // No `sounds`: the default is what a technician's phone is already
        // configured for, and a custom tone is a decision nobody has made.
      },
    ],
    [
      'expo-camera',
      {
        // Proof capture — doc §8. Gallery uploads are never accepted.
        cameraPermission:
          'Reliance GreenTech Technician needs the camera to capture installation proof.',
        recordAudioAndroid: false,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission:
          'Reliance GreenTech Technician needs your photos so you can set a profile picture.',
        cameraPermission:
          'Reliance GreenTech Technician needs the camera to take your profile picture.',
      },
    ],
    [
      'expo-location',
      {
        // FOREGROUND only — one reading at the shutter of the live site photo,
        // which is what evidences that the technician was actually there.
        // Background location is never requested: it needs a development build,
        // and following somebody around is not what this is for.
        locationWhenInUsePermission:
          'Reliance GreenTech Technician records where the live site photo was taken, to confirm the visit.',
        isAndroidBackgroundLocationEnabled: false,
      },
    ],
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        resizeMode: 'contain',
        backgroundColor: INK,
      },
    ],
    // Session tokens live in the Keychain / Android Keystore, never in plain
    // storage. First-party Expo, so Expo Go still runs the app unbuilt.
    'expo-secure-store',
  ],
  extra: {
    surfaceColor: SURFACE,
    // Written by hand because `eas init` cannot edit a dynamic config.
    // Must match `owner` above — the project lives under that account.
    eas: {
      projectId: '413ef3a0-47cc-4a8c-a90a-30da687d6924',
    },
  },
};

export default config;
