/**
 * Microsoft Clarity — UX-friction diagnosis (session replay, heatmaps,
 * rage-clicks). Fully automatic once initialized: nothing here calls an
 * explicit "track" function, only init and the optional identify/tag calls
 * Clarity's own SDK exposes.
 *
 * `@microsoft/clarity`'s package (see its `index.d.ts`) exports a single
 * default object — `init` / `setTag` / `identify` / … — not named exports, so
 * this module re-shapes that into the same init/no-op-safe pattern as the
 * other two integrations.
 */

import Clarity from "@microsoft/clarity";
import { CLARITY_ENABLED, CLARITY_PROJECT_ID } from "./config";

let initialized = false;

/** No-op when no project id is configured. Safe to call more than once. */
export function initClarity(): void {
  if (!CLARITY_ENABLED || initialized) return;
  initialized = true;
  Clarity.init(CLARITY_PROJECT_ID!);
}

/** Tags the current session with the signed-in user. No-op before init. */
export function clarityIdentify(
  userId: string,
  customProps?: Record<string, string>
): void {
  if (!initialized) return;
  // Clarity's `identify` signature is (customId, customSessionId?,
  // customPageId?, friendlyName?) — there is no properties bag, so a role or
  // company name goes through `setTag` instead, one call per key.
  Clarity.identify(userId);
  if (customProps) {
    for (const [key, value] of Object.entries(customProps)) {
      Clarity.setTag(key, value);
    }
  }
}

/** Tags the current session, e.g. with the current screen name. No-op before init. */
export function clarityTag(key: string, value: string): void {
  if (!initialized) return;
  Clarity.setTag(key, value);
}
