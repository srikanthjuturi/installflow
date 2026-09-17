import { existsSync } from 'node:fs';

import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * app.json IS the app's config. Expo reads it first and hands it to this
 * function as `config`; this file only adds the four things a JSON file cannot
 * say, because they depend on the build environment or on files that may be
 * absent:
 *
 *   1. the invite-link intent filter — its host comes from EXPO_PUBLIC_API_URL
 *   2. a white-label rebuild — BRAND_NAME / BRAND_MARK
 *   3. google-services.json — only when the file is there
 *   4. the notification icon — only when the file is there
 *
 * Anything else belongs in app.json. Check the result with
 * `npx expo config --type public`. JSON has no comments, so the reasons behind
 * app.json's less obvious values are kept at the bottom of this file.
 */

const GOOGLE_SERVICES_FILE = './google-services.json';
const NOTIFICATION_ICON = './assets/notification-icon.png';

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

/** Swaps one brand name for another in every string inside `value`. */
function rebrand<T>(value: T, from: string, to: string): T {
  if (from === to) return value;
  if (typeof value === 'string') return value.split(from).join(to) as T;
  if (Array.isArray(value)) return value.map((v) => rebrand(v, from, to)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, rebrand(v, from, to)]),
    ) as T;
  }
  return value;
}

/** Merges `options` into the named plugin's entry in app.json's `plugins`. */
function withPluginOptions(
  plugins: ExpoConfig['plugins'],
  name: string,
  options: Record<string, unknown>,
): ExpoConfig['plugins'] {
  return plugins?.map((entry) => {
    if (entry === name) return [name, options];
    if (Array.isArray(entry) && entry[0] === name) {
      return [name, { ...entry[1], ...options }];
    }
    return entry;
  });
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const { name, slug } = config;
  const defaultBrand: unknown = config.extra?.brandName;
  if (!name || !slug || typeof defaultBrand !== 'string' || !defaultBrand) {
    throw new Error('app.json must set expo.name, expo.slug and expo.extra.brandName.');
  }

  /**
   * The PLATFORM brand, for the handful of places no company can be named.
   *
   * In the app itself that is the login screen alone — signing in starts from
   * a phone number, and nothing says which company it belongs to until the
   * code is verified. Every screen after that draws the technician's own
   * company, which arrives with the session (see `src/hooks/useBrand.ts`).
   *
   * Outside the app it is also the launcher label, the OS permission prompts
   * and the artwork, all of which are baked in at build time and therefore
   * cannot be per-tenant without a build per tenant. The default is app.json's
   * `extra.brandName`, written out in full wherever app.json names the app; a
   * white-label build sets these two environment variables, and every one of
   * those spots is rewritten here. Nothing else in the app has to change.
   */
  const brandName = process.env.BRAND_NAME || defaultBrand;
  const brandMark = process.env.BRAND_MARK || config.extra?.brandMark;

  const invite = inviteHost();

  // Android draws the status-bar icon as a flat silhouette and falls back to a
  // featureless white square without a purpose-made asset. Wired conditionally
  // so dropping `notification-icon.png` in picks it up — naming a file that is
  // not there fails the config outright, and an ugly icon is a smaller problem
  // than a build that will not run.
  const plugins = existsSync(NOTIFICATION_ICON)
    ? withPluginOptions(config.plugins, 'expo-notifications', { icon: NOTIFICATION_ICON })
    : config.plugins;

  return {
    ...config,
    name: rebrand(name, defaultBrand, brandName),
    slug,
    plugins: rebrand(plugins, defaultBrand, brandName),
    android: {
      ...config.android,
      // FCM credentials for push. Referenced only when the file is present, so
      // a clone without it still runs — `expo start` and Expo Go do not need
      // it, and a hard reference to a missing path fails the config outright
      // rather than the one command that actually needs it.
      ...(existsSync(GOOGLE_SERVICES_FILE) ? { googleServicesFile: GOOGLE_SERVICES_FILE } : {}),
      // Android App Link. `autoVerify` makes Android fetch
      // https://<host>/.well-known/assetlinks.json AT INSTALL TIME and, if it
      // names this package and signing certificate, hand the link straight to
      // the app — so a technician taps the invite in WhatsApp and lands on the
      // invite screen, with no browser page in between.
      //
      // Omitted entirely when the host is unknown: an intent filter with no
      // host would claim every https link on the device.
      ...(invite
        ? {
            intentFilters: [
              ...(config.android?.intentFilters ?? []),
              {
                action: 'VIEW',
                autoVerify: true,
                category: ['BROWSABLE', 'DEFAULT'],
                data: [{ scheme: 'https', host: invite, pathPrefix: '/invite' }],
              },
            ],
          }
        : {}),
    },
    extra: {
      ...config.extra,
      brandName,
      brandMark,
    },
  };
};

/*
 * ─── Why app.json says what it says ─────────────────────────────────────────
 *
 * Colours `#141b22` (INK) and `#eef1f3` (app surface) are written as literals
 *   in app.json because the Expo CLI reads it before Metro exists, so it
 *   cannot import the design tokens. Keep them in sync with
 *   src/theme/tokens.js.
 *
 * slug "videocon-technician" is NOT the product name, and never shown to a
 *   technician — `name` is what appears under the launcher icon. Deliberately
 *   still the pre-rebrand value: an Expo project's slug is fixed at creation,
 *   so renaming it would mean a NEW project, a new projectId and fresh
 *   credentials — hence a new signing keystore, which would invalidate the
 *   SHA-256 already published in the API's assetlinks.json and silently break
 *   every App Link. `extra.eas.projectId` must match `owner`: the project
 *   lives under that account.
 *
 * scheme "reliancegreentech" carries invite deep links:
 *   reliancegreentech://invite/<token>.
 *
 * userInterfaceStyle "light" — no dark mode in v1; these screens are used
 *   outdoors.
 *
 * android.package must match the Android app registered in Firebase character
 *   for character. A mismatch does not error anywhere: FCM simply accepts the
 *   send and never delivers it.
 *
 * android.blockedPermissions strips these from the RELEASE manifest, where
 *   Google Play lists every permission on the store page and asks about each
 *   one. Nothing here records sound or draws over other apps.
 *   `recordAudioAndroid: false` on expo-camera is NOT enough on its own:
 *   expo-camera's library manifest declares RECORD_AUDIO regardless and Gradle
 *   merges it in, and the expo-image-picker plugin adds it again. Only a block
 *   — `tools:node="remove"` — wins over both. SYSTEM_ALERT_WINDOW comes from
 *   the Expo template for the dev overlay; a debug build keeps it through its
 *   own manifest, so the dev client is unaffected.
 *
 * android.softwareKeyboardLayoutMode "resize" is inert while
 *   edgeToEdgeEnabled is on — the app draws behind the IME, so the window does
 *   NOT resize for the keyboard and this setting has nothing to act on.
 *   Keyboard avoidance is done in JS instead; see
 *   src/components/layout/KeyboardFlow.tsx. Kept at the default so that
 *   turning edge-to-edge off restores resizing rather than panning — but
 *   KeyboardFlow's `behavior` would then need revisiting, or the keyboard gets
 *   subtracted twice.
 *
 * expo-notifications has no `sounds`: the default is what a technician's phone
 *   is already configured for, and a custom tone is a decision nobody has
 *   made.
 *
 * expo-camera is proof capture — doc §8; gallery uploads are never accepted.
 *   Also the payout account's QR scan, which reads a UPI ID and stores no
 *   picture. A change takes effect on the next native build, not in Expo Go.
 *
 * expo-location is FOREGROUND only — one reading at the shutter of the live
 *   site photo, which is what evidences that the technician was actually
 *   there. Background location is never requested: it needs a development
 *   build, and following somebody around is not what this is for.
 *
 * expo-secure-store keeps session tokens in the Keychain / Android Keystore,
 *   never in plain storage. First-party Expo, so Expo Go still runs the app
 *   unbuilt.
 *
 * extra.brandName / extra.brandMark are read by `src/lib/brand.ts`. Via
 *   `extra` rather than `process.env`, because only `EXPO_PUBLIC_*` is
 *   inlined into the bundle and the brand is not something a device should be
 *   able to influence.
 */
