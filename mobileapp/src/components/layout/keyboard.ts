import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * How tall the software keyboard is right now, in points. `0` when hidden.
 *
 * This app is EDGE-TO-EDGE, which is the whole reason this exists. Drawing
 * behind the system bars stops Android resizing the window for the IME, so
 * `softwareKeyboardLayoutMode: 'resize'` is inert and nothing moves on its own
 * — see the long note in `KeyboardFlow`. A screen that cannot use that
 * component (a camera must fill its space, not scroll) has to do the sum
 * itself, and this is the measurement it needs.
 *
 * The height already covers the navigation bar, because the keyboard is drawn
 * over it. So a layout padding itself by this value must NOT also add
 * `insets.bottom` while the keyboard is up, or it leaves a bar-sized gap.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    // iOS gets the `will` pair so the layout moves WITH the keyboard rather
    // than a frame behind it; Android only ever emits the `did` pair.
    const show = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hide = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const subs = [
      // `keyboardDidShow` fires again when the keyboard CHANGES height — a
      // switch to emoji, or a suggestion strip appearing. Reading the event
      // every time rather than only the first keeps the layout correct.
      Keyboard.addListener(show, (e) => setHeight(e.endCoordinates.height)),
      Keyboard.addListener(hide, () => setHeight(0)),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);

  return height;
}

/** True while the software keyboard is on screen. */
export function useKeyboardVisible(): boolean {
  return useKeyboardHeight() > 0;
}
