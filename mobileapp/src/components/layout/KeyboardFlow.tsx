import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';

export interface KeyboardFlowProps {
  children: ReactNode;
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
 * `behavior` is iOS-only on purpose. Android is set to
 * `softwareKeyboardLayoutMode: 'resize'` in app.config.ts, so the OS already
 * shrinks the window; adding `height` or `padding` on top of that subtracts the
 * keyboard twice and leaves a gap the size of a keyboard above it. For the same
 * reason nothing here may also set `automaticallyAdjustKeyboardInsets` — that
 * is the iOS half of the same double count.
 */
export function KeyboardFlow({ children }: KeyboardFlowProps) {
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
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
    </KeyboardAvoidingView>
  );
}
