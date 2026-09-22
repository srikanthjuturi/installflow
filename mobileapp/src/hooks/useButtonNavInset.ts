import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * The smallest bottom inset that means Android's 3-button bar (◁ ○ □).
 *
 * The app is edge-to-edge, so the system bar is drawn OVER the bottom of every
 * screen and `insets.bottom` says how much of it is covered. The two Android
 * navigation modes report very different amounts: the button bar is ~48 dp,
 * the gesture strip 0–24 dp. An iPhone's home line is 34 — iOS is excluded by
 * platform anyway. 40 sits clear of all of them.
 *
 * A threshold rather than the real setting because the real setting is only
 * readable through a native module, and adding one is a flagged decision here.
 */
const BUTTON_NAV_MIN_DP = 40;

/**
 * How tall Android's 3-button navigation bar is when the phone shows one —
 * else 0.
 *
 * For the places that must move up on a button phone and stay EXACTLY as they
 * are everywhere else. The tab bar is the reason it exists: its fixed height
 * looks right against a gesture strip, which is what it was drawn against, and
 * sat under the ◁ ○ □ buttons on every phone that has them.
 *
 * Not a replacement for `insets.bottom`. A pinned footer or a sheet that
 * already adds the full inset is right on both kinds of phone — leave it.
 *
 * Landscape moves the buttons to the side, the bottom inset drops to 0, and so
 * does this.
 */
export function useButtonNavInset(): number {
  const { bottom } = useSafeAreaInsets();
  return Platform.OS === 'android' && bottom >= BUTTON_NAV_MIN_DP ? bottom : 0;
}
