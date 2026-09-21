/**
 * The capture orchestrator.
 *
 * Runs each target, writes `out/shots.json`, and fails loudly rather than
 * producing a deck with a missing or an unmasked screen. `--only=<target>`
 * re-runs one surface without re-shooting the rest.
 */

import { chromium } from 'playwright';
import { createRecorder, TARGET_PREFIXES } from './lib/shot.mjs';

/**
 * Targets are imported lazily and by name so that one surface being broken —
 * or its credentials being absent — does not stop the other three from
 * producing their half of the deck.
 */
const TARGETS = {
  prototype: () => import('./prototype.mjs').then((m) => m.capturePrototype),
  console: () => import('./console.mjs').then((m) => m.captureConsole),
  superadmin: () => import('./superadmin.mjs').then((m) => m.captureSuperadmin),
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
/* Only a target that ran to completion may prune its own prefixes. One that
   threw halfway has recorded some of its shots and not others, and treating
   that as authoritative would delete the survivors of the last good run. */
const completed = [];

for (const name of selected) {
  process.stdout.write(`\n▸ ${name}\n`);
  try {
    const capture = await TARGETS[name]();
    await capture({ browser, recorder });
    completed.push(name);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    process.stdout.write(`  ✗ ${error.message}\n`);
  }
}

await browser.close();

const authoritative = completed.flatMap((name) => TARGET_PREFIXES[name] ?? []);
const { total, written, dropped } = await recorder.write({ authoritative });
process.stdout.write(`\n${written} shot(s) captured, ${total} in out/shots.json\n`);

if (dropped.length) {
  process.stdout.write(`\n${dropped.length} stale shot(s) removed:\n`);
  for (const id of dropped) process.stdout.write(`  − ${id}\n`);
}

if (failures.length) {
  process.stdout.write(`\n${failures.length} target(s) failed:\n`);
  for (const failure of failures) process.stdout.write(`  ✗ ${failure}\n`);
  /* Their previous shots are still in the manifest, so the build below would
     succeed and produce a deck that mixes two capture runs without saying so. */
  process.stdout.write('  → dist/ will MIX runs if you build on this manifest.\n');
  process.exit(1);
}
