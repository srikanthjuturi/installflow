/**
 * The API interceptor: one `page.route` doing two jobs that must both hold on
 * every request, so they live together rather than as two handlers racing to
 * fulfil the same route.
 *
 *   1. GUARD  — abort any write to the API that is not on the allowlist.
 *   2. MASK   — pseudonymise customer PII in the response body.
 *
 * The guard is a hard backstop, not a convention. The shot list is written to
 * navigate and read only, but a stray click on "Assign" in a production console
 * would assign a real job to a real technician, and a rule that depends on
 * every future edit to the shot list being careful is not a rule.
 */

import { maskTree } from './mask.mjs';

/**
 * The only writes a capture run may perform, and why each is unavoidable:
 *   - `/auth/login`      the console session has to exist before any screen renders.
 *   - `/auth/otp/*`      the technician app is OTP-only; there is no other door.
 *   - `/auth/refresh`    a 30-minute access token expires mid-run on a long capture.
 *   - `/auth/switch-company`  re-scopes the token; reads only, despite the verb.
 *
 * Everything else — accept, assign, cancel, bonus, force-close, no-show,
 * reschedule, and every form submit — is aborted.
 */
const ALLOWED_WRITES = [
  /\/auth\/login$/,
  /\/auth\/otp\//,
  /\/auth\/refresh$/,
  /\/auth\/switch-company$/,
];

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * @param {object} options
 * @param {string} options.label     names this context in every error
 * @param {boolean} [options.readOnly=true]  abort writes that are not sign-in
 * @param {boolean} [options.mask=true]      pseudonymise customer PII
 *
 * `mask: false` is for capturing a seeded DEVELOPMENT tenant, where every
 * customer is already invented in `seed/fixtures.mjs`. Rewriting those names
 * into different invented names would only churn the deck between runs and lose
 * the ones the story was written around.
 */
export function createInterceptor({ label, readOnly = true, mask = true }) {
  const state = {
    blocked: [],
    maskedFields: 0,
    maskedResponses: 0,
    /** url -> fields rewritten, so a shot can assert its own screen was masked. */
    byUrl: new Map(),
  };

  async function handle(route) {
    const request = route.request();
    const url = request.url();
    const method = request.method();

    const isApi = url.includes('/api/v1/');

    if (isApi && readOnly && !READ_METHODS.has(method)) {
      const allowed = ALLOWED_WRITES.some((re) => re.test(new URL(url).pathname));
      if (!allowed) {
        state.blocked.push(`${method} ${url}`);
        // Abort rather than fulfil an empty 200: a silent success would let the
        // UI render as though the write had happened, and the slide would then
        // show a state production is not in.
        await route.abort('blockedbyclient');
        return;
      }
    }

    if (!isApi) {
      await route.continue();
      return;
    }

    let response;
    try {
      response = await route.fetch();
    } catch {
      // A request cancelled by the app mid-navigation is normal, not a failure.
      await route.abort('failed').catch(() => {});
      return;
    }

    const contentType = response.headers()['content-type'] ?? '';
    if (!mask || !contentType.includes('application/json')) {
      await route.fulfill({ response }).catch(() => {});
      return;
    }

    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      await route.fulfill({ response, body: text }).catch(() => {});
      return;
    }

    const { count, originals } = maskTree(payload);
    const body = JSON.stringify(payload);

    // A value we replaced must not survive anywhere else in the same payload —
    // a second field carrying the customer's name under a key we do not know
    // would otherwise sail through masked=1 and onto a slide.
    const leaked = originals.filter((value) => body.includes(value));
    if (leaked.length) {
      throw new Error(
        `[${label}] masking leak on ${new URL(url).pathname}: ` +
          `${leaked.length} original value(s) survived into the response body. ` +
          `Add the carrying field to RULES in capture/lib/mask.mjs.`,
      );
    }

    if (count) {
      state.maskedFields += count;
      state.maskedResponses += 1;
      const path = new URL(url).pathname;
      state.byUrl.set(path, (state.byUrl.get(path) ?? 0) + count);
    }

    await route
      .fulfill({ response, body, headers: { ...response.headers(), 'content-length': String(Buffer.byteLength(body)) } })
      .catch(() => {});
  }

  return {
    state,
    /** Attach to a context so every page in it inherits the guard. */
    async install(context) {
      await context.route('**/*', handle);
    },
    /**
     * Called after a screen that is known to carry customer data. Zero rewrites
     * there means the field names moved — fail rather than ship the screenshot.
     */
    assertMasked(pathFragment) {
      // Nothing to assert when the data was invented in the first place.
      if (!mask) return;
      const hit = [...state.byUrl.entries()].find(([path]) => path.includes(pathFragment));
      if (!hit) {
        throw new Error(
          `[${label}] expected customer PII to be masked on a response matching ` +
            `"${pathFragment}", but no such response rewrote any field. ` +
            `Either the screen did not load or TicketOut's field names changed.`,
        );
      }
    },
    /** Throws at the end of a run if anything tried to write to production. */
    assertNoWrites() {
      if (state.blocked.length) {
        throw new Error(
          `[${label}] the shot list attempted ${state.blocked.length} production write(s), ` +
            `which were blocked:\n  ${state.blocked.join('\n  ')}\n` +
            `Capture is navigation and reads only — remove the offending step.`,
        );
      }
    },
  };
}
