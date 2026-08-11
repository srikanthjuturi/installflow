import type { ExpoConfig } from 'expo/config';

// Colours are duplicated as literals ONLY here: app.config.ts is evaluated by
// the Expo CLI before Metro exists, so it cannot resolve the `@/` alias.
// Values must stay in sync with src/theme/tokens.js.
const INK = '#141b22';
const SURFACE = '#eef1f3';

const config: ExpoConfig = {
  name: 'Videocon Technician',
  slug: 'videocon-technician',
  // The organisation, not a personal account: builds and — more importantly —
  // the Android signing key belong to the team. A signing key cannot be changed
  // after the app is published without every user reinstalling.
  owner: 'srikanthjuturis-team',
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
    eas: {
      projectId: 'c7b3c920-371b-4aed-b72e-517c16f554da',
    },
  },
};

export default config;
