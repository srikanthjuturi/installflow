import { createContext, useContext } from 'react';

/**
 * Asks the nearest `KeyboardFlow` to bring the focused field into view.
 *
 * A context rather than a prop because the fields that need it sit several
 * components deep — an `Input` inside a card inside a form — and the flow that
 * does the scrolling sits several above. Outside a `KeyboardFlow` there is
 * nobody to ask, and calling it does nothing.
 *
 * Its own module, not `KeyboardFlow.tsx`, so `components/ui/Input` can import
 * it without pulling the layout barrel into the ui one.
 */
export const KeyboardRevealContext = createContext<() => void>(() => {});

/** For a text field: call it from `onFocus`. */
export function useKeyboardReveal(): () => void {
  return useContext(KeyboardRevealContext);
}
