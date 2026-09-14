import { type ReactNode, type RefObject, useCallback, useEffect, useRef } from 'react';
import {
  KeyboardAvoidingView,
  ScrollView,
  type StyleProp,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useKeyboardHeight } from './keyboard';
import { KeyboardRevealContext } from './keyboardReveal';

/** Room kept above a field brought into view, so its label comes with it. */
const FIELD_HEADROOM = 32;

export interface KeyboardFlowProps {
  children: ReactNode;
  /**
   * Pinned below the scroll and above the keyboard — a screen's CTA bar.
   * Clearance for the navigation bar is handled here, so a footer passed in
   * must NOT add `insets.bottom` itself.
   */
  footer?: ReactNode;
  /**
   * Styles the strip that holds the footer, INCLUDING the navigation-bar
   * clearance under it, which a style on the footer itself cannot reach. A
   * white action bar on a grey screen puts its background and top border here,
   * or the clearance shows as a grey band beneath the bar.
   */
  footerStyle?: StyleProp<ViewStyle>;
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
 * ## The field being typed into stays in sight — with no set-up on the screen
 *
 * Making room is half of it. Once the keyboard is up nothing brings the focused
 * field INTO that room: Android scrolls a focused input only far enough to show
 * the input itself — for a one-time code that leaves "Verify" under the keys —
 * and iOS scrolls nothing at all.
 *
 * So this does it for every field inside. Whenever the keyboard opens or
 * changes height, the viewport or the content changes size, or another field
 * takes focus, it scrolls to the LOWEST point that still shows the focused
 * field with its label. When the field is near enough the end, that is the end
 * — the field and the button under it together. When it is not, the field sits
 * at the top of the view. A field is never scrolled out of sight to show a
 * button.
 *
 * Fields report focus through `useKeyboardReveal`, and `Input` and `OtpInput`
 * already do. A bare `TextInput` placed in a flow should call it from `onFocus`
 * too: the keyboard opening covers a lone field, but moving between two fields
 * with the keyboard already up raises no keyboard event at all.
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
export function KeyboardFlow({ children, footer, footerStyle }: KeyboardFlowProps) {
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const keyboardVisible = keyboardHeight > 0;

  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<View>(null);
  // Read by callbacks that native events fire later, so refs rather than one
  // render's values.
  const viewportHeight = useRef(0);
  const contentHeight = useRef(0);
  const keyboardUp = useRef(false);

  const reveal = useCallback(() => {
    // A frame later, on purpose. The avoiding view pads only after it has
    // measured, and a field that has just mounted (the code, once it is sent)
    // has no position yet — aiming before either lands aims at the old layout.
    // `onLayout` and `onContentSizeChange` below call this again when they do.
    requestAnimationFrame(() => {
      const scroll = scrollRef.current;
      const content = contentRef.current;
      if (!keyboardUp.current || !scroll || !content) return;
      // Only once a keyboard is known to be up. react-native-web has no
      // `currentlyFocusedInput`, and it never reports a keyboard, so the
      // browser build never reaches this line — asked first, it threw on
      // every layout.
      const field = TextInput.State.currentlyFocusedInput();
      if (!field) return;

      field.measureLayout(
        content,
        (_x, y) => {
          const end = Math.max(contentHeight.current - viewportHeight.current, 0);
          scroll.scrollTo({ y: Math.max(0, Math.min(end, y - FIELD_HEADROOM)), animated: true });
        },
        // Not inside this scroll — a field in the footer, which is already
        // above the keyboard and needs nothing.
        () => {},
      );
    });
  }, []);

  useEffect(() => {
    keyboardUp.current = keyboardHeight > 0;
    if (keyboardHeight > 0) reveal();
  }, [keyboardHeight, reveal]);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView
        ref={scrollRef}
        // The typings want a non-null ref object; the prop is a ref setter at
        // runtime and takes the null the ref starts as.
        innerViewRef={contentRef as RefObject<View>}
        onLayout={(e) => {
          viewportHeight.current = e.nativeEvent.layout.height;
          reveal();
        }}
        onContentSizeChange={(_w, h) => {
          contentHeight.current = h;
          reveal();
        }}
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        // Taps on the CTA land the first time instead of being eaten by the
        // keyboard dismissing — the difference between one tap and two.
        keyboardShouldPersistTaps="handled"
        // Dragging also puts the keyboard away, so scrolling by hand never
        // fights the reveal above: with the keyboard down it does nothing.
        keyboardDismissMode="on-drag"
        // Nothing here is long enough to bounce; on a form it reads as jitter.
        bounces={false}
      >
        <KeyboardRevealContext value={reveal}>{children}</KeyboardRevealContext>
      </ScrollView>

      {footer ? (
        /* With the keyboard up the navigation bar sits on top of it, so the
           footer is already clear of it — adding the inset then would leave a
           bar-sized gap between the CTA and the keys. */
        <View style={[{ paddingBottom: keyboardVisible ? 0 : insets.bottom }, footerStyle]}>
          {footer}
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}
