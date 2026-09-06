import Constants from 'expo-constants';

/**
 * The PLATFORM brand — what the app calls itself before it knows whose app it
 * is.
 *
 * A technician signs in with a phone number, and nothing identifies their
 * company until the OTP succeeds. So the login screen genuinely has no company
 * to name and this is the honest answer there. Everywhere after that, the
 * session carries the company and `useBrand` returns it instead.
 *
 * Read from the Expo config rather than written into a component so that a
 * franchise build is an `app.config.ts` change. `extra` is the supported way
 * to get a build-time value into the bundle — `process.env` is inlined only
 * for `EXPO_PUBLIC_*`, and this is not something a technician's device should
 * be able to influence.
 */
const extra = Constants.expoConfig?.extra as
  | { brandName?: string; brandMark?: string }
  | undefined;

export const BRAND_NAME = extra?.brandName || 'Reliance GreenTech';

/**
 * The two-or-three letters in the tile. A company's own mark is its stored
 * `code` — derived from the name once by the API and never recomputed — so the
 * app never derives one itself.
 */
export const BRAND_MARK = extra?.brandMark || 'RG';
