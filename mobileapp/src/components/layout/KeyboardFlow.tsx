import { useEffect, useState, type ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** True while the software keyboard is on screen. */
function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // iOS gets the `will` pair so the footer moves with the keyboard rather
    // than a frame behind it; Android only ever emits the `did` pair.
    const show = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hide = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const subs = [
      Keyboard.addListener(show, () => setVisible(true)),
      Keyboard.addListener(hide, () => setVisible(false)),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);

  return visible;
}

export interface KeyboardFlowProps {
  children: ReactNode;
  /**
   * Pinned below the scroll and above the keyboard — a screen's CTA bar.
   * Clearance for the navigation bar is handled here, so a footer passed in
   * must NOT add `insets.bottom` itself.
   */
  footer?: ReactNode;
}

/**
 * A single-column flow whose CTA survives the keyboard.
 *
 * The failure this exists to prevent: a screen laid out as a fixed column with
 * `<View style={{ flex: 1 }} />` pushing the button to the bottom looks right
 * until the keyboard opens. The window shrinks, the spacer collapses to zero,
 * and the remaining content is taller than what is left — so the button is
 * clipped off the bottom edge with no way to reach it. On the sign-in screen
 * that means a technician who cannot sign in at all.
 *
 * `flexGrow: 1` on the content container is what fixes it, and it is doing two
 * jobs at once:
 *
 *  - with room to spare the container fills the viewport, so a `flex: 1` spacer
 *    inside still pushes the CTA to the bottom — the prototype's
 *    `margin-top: auto`, unchanged, and with the keyboard up "the bottom" is
 *    directly above the keyboard, which is where the CTA should be;
 *  - without room the container grows past the viewport and the view scrolls
 *    instead of clipping.
 *
 * ## `behavior` is set on Android too, and must be
 *
 * A `KeyboardAvoidingView` with no `behavior` is a plain `View`: React Native's
 * own implementation falls through to a `default` branch that renders one with
 * no keyboard adjustment at all. The familiar Android advice — "just having the
 * KeyboardAvoidingView prevents covering the input" — only ever held because
 * `windowSoftInputMode: adjustResize` shrank the window underneath it.
 *
 * Edge-to-edge ends that. The app draws behind the system bars and the IME, so
 * the window no longer resizes and `softwareKeyboardLayoutMode: 'resize'` in
 * app.config.ts is inert; Expo's own note on the change is "like on iOS, you'll
 * need to use KeyboardAvoidingView". Leaving `behavior` unset therefore meant
 * nothing on Android moved for the keyboard on any screen — the field being
 * typed into stayed covered and the CTA stayed buried.
 *
 * Hence `padding` on both platforms. If `edgeToEdgeEnabled` is ever turned off
 * the window would start resizing again and this would subtract the keyboard
 * twice, so revisit here first. For the same reason nothing inside may also set
 * `automaticallyAdjustKeyboardInsets` — that is the iOS half of the same double
 * count.
 */
export function KeyboardFlow({ children, footer }: KeyboardFlowProps) {
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        // Taps on the CTA land the first time instead of being eaten by the
        // keyboard dismissing — the difference between one tap and two.
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        // Nothing here is long enough to bounce; on a form it reads as jitter.
        bounces={false}
      >
        {children}
      </ScrollView>

      {footer ? (
        /* With the keyboard up the navigation bar sits on top of it, so the
           footer is already clear of it — adding the inset then would leave a
           bar-sized gap between the CTA and the keys. */
        <View style={{ paddingBottom: keyboardVisible ? 0 : insets.bottom }}>{footer}</View>
      ) : null}
    </KeyboardAvoidingView>
  );
}
