/**
 * The capture orchestrator.
 *
 * Runs each target, writes `out/shots.json`, and fails loudly rather than
 * producing a deck with a missing or an unmasked screen. `--only=<target>`
 * re-runs one surface without re-shooting the rest.
 */

import { chromium } from 'playwright';
import { createRecorder } from './lib/shot.mjs';

/**
 * Targets are imported lazily and by name so that one surface being broken —
 * or its credentials being absent — does not stop the other three from
 * producing their half of the deck.
 */
const TARGETS = {
  prototype: () => import('./prototype.mjs').then((m) => m.capturePrototype),
  console: () => import('./console.mjs').then((m) => m.captureConsole),
  mobile: () => import('./mobile.mjs').then((m) => m.captureMobile),
  customer: () => import('./customer.mjs').then((m) => m.captureCustomer),
};

const only = process.argv
  .find((arg) => arg.startsWith('--only='))
  ?.slice('--only='.length)
  .split(',');

const selected = only ?? Object.keys(TARGETS);

for (const name of selected) {
  if (!TARGETS[name]) {
    console.error(`unknown target "${name}". Known: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(1);
  }
}

const recorder = await createRecorder();
const browser = await chromium.launch();
const failures = [];

for (const name of selected) {
  process.stdout.write(`\n▸ ${name}\n`);
  try {
    const capture = await TARGETS[name]();
    await capture({ browser, recorder });
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    process.stdout.write(`  ✗ ${error.message}\n`);
  }
}

await browser.close();

const { total, written } = await recorder.write();
process.stdout.write(`\n${written} shot(s) captured, ${total} in out/shots.json\n`);

if (failures.length) {
  process.stdout.write(`\n${failures.length} target(s) failed:\n`);
  for (const failure of failures) process.stdout.write(`  ✗ ${failure}\n`);
  process.exit(1);
}
