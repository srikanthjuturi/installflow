import { useEffect, useState } from "react";

/**
 * A value that lags behind by `delay`, for things that should not fire on every
 * keystroke.
 *
 * Only the *request* is debounced, never the input. The control that produced
 * the value stays fully controlled and repaints immediately; it is the query
 * key derived from it that waits, so typing never feels sticky and a
 * six-character search costs one request rather than six.
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    // Nothing to wait for — going straight there keeps a cleared box from
    // showing stale results for another third of a second.
    if (value === settled) return;
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, settled, delay]);

  return settled;
}
