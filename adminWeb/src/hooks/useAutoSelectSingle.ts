import { useEffect } from "react";

/**
 * When a dropdown resolves to exactly one choice, pick it for the user instead
 * of making them open a single-item menu. See the "single-option dropdowns
 * auto-fill" hard rule in `adminWeb/AGENTS.md`.
 *
 * Runs only while the field is empty, so it never overrides a real selection
 * and never fights a value that arrived from the server (an edit form). Pass
 * `enabled: false` to hold off while the option list is still loading or the
 * control is disabled — otherwise an empty list briefly looks like "one option"
 * as it streams in.
 *
 * `options` is expected to be the same primitive values the control stores
 * (role keys, region ids, vendor names), so the single value can be handed
 * straight to `onSelect`.
 */
export function useAutoSelectSingle<T>(
  options: readonly T[],
  value: T | "" | null | undefined,
  onSelect: (value: T) => void,
  enabled = true
): void {
  const only = options.length === 1 ? options[0] : undefined;
  const isEmpty = value === "" || value === null || value === undefined;

  useEffect(() => {
    if (!enabled || only === undefined || !isEmpty) return;
    onSelect(only);
    // `onSelect` is a fresh closure each render; the guards above make the
    // effect idempotent, so re-running on that identity change is harmless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, only, isEmpty]);
}
