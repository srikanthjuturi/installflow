/**
 * The shot recorder. Every capture target funnels through `record()` so that a
 * screenshot and its caption are written in one place — the deck builder reads
 * `shots.json` and never guesses which PNG belongs to which slide.
 */

import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DECK_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
export const REPO_ROOT = path.resolve(DECK_ROOT, '..');
export const OUT_DIR = path.join(DECK_ROOT, 'out');
export const PNG_DIR = path.join(OUT_DIR, 'png');
export const SHOTS_JSON = path.join(OUT_DIR, 'shots.json');

/**
 * `shots.json` is a flat INVENTORY, not a deck. The catalogue is generated from
 * it by grouping on `section`; the overview deck is a hand-written storyboard in
 * `build/storyboard.py` that names shot ids per slide. Keeping the two apart is
 * what lets one slide hold four phone shots without the capture code knowing
 * anything about slide layout.
 */
export async function createRecorder() {
  await mkdir(PNG_DIR, { recursive: true });
  const shots = [];
  const seen = new Set();

  return {
    shots,

    /**
     * @param {object}  spec
     * @param {string}  spec.id       stable slug; also the PNG filename, and how
     *                                the overview storyboard refers to this shot
     * @param {string}  spec.section  catalogue section heading
     * @param {string}  spec.title    3-6 word headline. The slide's only large text.
     * @param {string} [spec.sub]     at most one supporting line
     * @param {'console'|'phone'} spec.kind  decides the slide layout
     * @param {boolean} [spec.catalogue=true]  false for a shot the overview uses
     *                                but the leave-behind would only repeat
     * @param {import('playwright').Page|import('playwright').Locator} spec.target
     */
    async record(spec) {
      const { id, section, title, sub = '', kind, target, order, catalogue = true } = spec;

      if (seen.has(id)) throw new Error(`duplicate shot id: ${id}`);
      seen.add(id);

      const file = path.join(PNG_DIR, `${id}.png`);
      await target.screenshot({ path: file, animations: 'disabled', scale: 'device' });

      shots.push({
        id,
        file: path.relative(DECK_ROOT, file).split(path.sep).join('/'),
        section,
        title,
        sub,
        kind,
        catalogue,
        order: order ?? shots.length,
      });

      process.stdout.write(`  ✓ ${id}\n`);
    },

    /**
     * Merge into the existing manifest rather than replace it.
     *
     * `--only=console` must not throw away the prototype's shots, and the file
     * order is what gives each catalogue section its within-section running
     * order — so entries keep their place and are updated where they were,
     * with anything new appended.
     */
    async write() {
      let previous = [];
      try {
        previous = JSON.parse(await readFile(SHOTS_JSON, 'utf8'));
      } catch {
        // No manifest yet, or an unreadable one. Either way, start from these.
      }

      const fresh = new Map(shots.map((shot) => [shot.id, shot]));
      const merged = previous.map((old) => fresh.get(old.id) ?? old);
      const kept = new Set(merged.map((shot) => shot.id));
      for (const shot of shots) if (!kept.has(shot.id)) merged.push(shot);

      await writeFile(SHOTS_JSON, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
      return { total: merged.length, written: shots.length };
    },
  };
}

/** Wipe previous output for a target so a removed shot cannot linger in the deck. */
export async function clearTarget(prefix) {
  await rm(path.join(PNG_DIR, prefix), { recursive: true, force: true });
}
