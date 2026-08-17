import type { ExpoConfig } from 'expo/config';

// Colours are duplicated as literals ONLY here: app.config.ts is evaluated by
// the Expo CLI before Metro exists, so it cannot resolve the `@/` alias.
// Values must stay in sync with src/theme/tokens.js.
const INK = '#141b22';
const SURFACE = '#eef1f3';

/**
 * The host that serves invite links, taken from the API URL so there is exactly
 * ONE place to change when the dev tunnel hands out a new name.
 *
 * It is compiled into the Android intent filter below, which is what lets a
 * WhatsApp invite open the app directly instead of a browser. That also means
 * a new hostname needs a new build — the price of a throwaway tunnel, and the
 * thing a real domain would end.
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
  name: 'Videocon Technician',
  slug: 'videocon-technician',
  owner: 'srikanth24',
  scheme: 'videocontech', // invite deep links: videocontech://invite/<token>
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
    bundleIdentifier: 'net.deccansoft.videocontechnician',
  },
  android: {
    package: 'net.deccansoft.videocontechnician',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: INK,
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    // Explicit rather than relying on the default: with edge-to-edge on, the
    // window must resize when the keyboard opens or it covers the field being
    // typed into (pincode entry, OTP).
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
      'expo-camera',
      {
        // Proof capture — doc §8. Gallery uploads are never accepted.
        cameraPermission: 'Videocon Technician needs the camera to capture installation proof.',
        recordAudioAndroid: false,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission:
          'Videocon Technician needs your photos so you can set a profile picture.',
        cameraPermission: 'Videocon Technician needs the camera to take your profile picture.',
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
