import { useFocusEffect } from 'expo-router';
import { setStatusBarStyle, type StatusBarStyle } from 'expo-status-bar';
import { useCallback } from 'react';

export interface ScreenStatusBarProps {
  /** `light` = white icons (for the dark chrome header); `dark` = black icons. */
  style: StatusBarStyle;
}

/**
 * Status bar styling that survives a tab switch.
 *
 * `<StatusBar style="…" />` from expo-status-bar applies its style when it
 * MOUNTS. That is fine for a pushed screen, and quietly wrong inside a tab
 * navigator, because tab screens stay mounted once visited — so switching back
 * to a tab re-renders it without remounting, and its StatusBar never re-applies.
 *
 * The visible failure: Home, Earnings and Profile all sit on the dark chrome
 * and ask for `light` (white) icons. My jobs is the only tab with a WHITE
 * header and needs `dark` ones. Coming from any other tab, the white icons
 * stayed — white on white, so the battery, clock and signal simply vanished.
 *
 * `useFocusEffect` is the fix because it fires on every focus rather than only
 * on mount, so whichever screen the technician is actually looking at is the one
 * that decides. Setting it imperatively rather than rendering `<StatusBar>` also
 * means there is exactly one mechanism in play — two would race on tab change.
 */
export function ScreenStatusBar({ style }: ScreenStatusBarProps) {
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle(style, true);
    }, [style]),
  );

  return null;
}
