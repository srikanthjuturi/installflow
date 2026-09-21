/**
 * Render the built map to a PNG and a PDF.
 *
 *     node experience-map/build.mjs && node experience-map/render.mjs
 *
 * The page itself is `out/experience-map/index.html`, written by `build.mjs`.
 * This only photographs it, so the two deliverables — the hosted page and the
 * file somebody emails — are the same document rather than two designs that
 * drift apart.
 *
 * Output follows the `dist/` naming the other three deliverables use:
 *     dist/Reliance GreenTech - Product Experience Map.png
 *     dist/Reliance GreenTech - Product Experience Map.pdf
 */

import { mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DECK_ROOT = path.resolve(HERE, '..');
const PAGE = path.join(DECK_ROOT, 'out', 'experience-map', 'index.html');
const DIST = path.join(DECK_ROOT, 'dist');
const NAME = 'Reliance GreenTech - Product Experience Map';

/** Wide enough that a console screenshot is legible at two-up. */
const VIEWPORT = { width: 1800, height: 1200 };

try {
  await access(PAGE);
} catch {
  console.error('no out/experience-map/index.html — run `node experience-map/build.mjs` first');
  process.exit(1);
}

await mkdir(DIST, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: VIEWPORT,
  // 1 was the old setting and it is why the previous map's phones were mush.
  // These are screenshots OF screenshots; at 1 the UI inside them is gone.
  deviceScaleFactor: 2,
  colorScheme: 'light',
});

await page.goto(pathToFileURL(PAGE).href, { waitUntil: 'networkidle' });

// `networkidle` is not enough on its own for either of these.
await page.evaluate(async () => {
  await Promise.all(
    [...document.images].map((image) =>
      image.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
            image.addEventListener('load', resolve, { once: true });
            // Resolve rather than reject: one broken picture must not cost the
            // whole render, and the build step already failed loudly for it.
            image.addEventListener('error', resolve, { once: true });
          }),
    ),
  );
  // The old renderer skipped this, so a slow webfont could be photographed
  // mid-swap — every heading in the fallback face.
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
});

const pngPath = path.join(DIST, `${NAME}.png`);
await page.screenshot({ path: pngPath, fullPage: true });

const size = await page.evaluate(() => ({
  width: document.documentElement.scrollWidth,
  height: document.documentElement.scrollHeight,
}));

const pdfPath = path.join(DIST, `${NAME}.pdf`);
/* A few pixels of headroom, because laying the page out for print is not
   pixel-identical to laying it out for the screen: the measured scroll height
   came up a hair short and spilled a sliver onto a second page, which on a map
   reads as a printing fault rather than a second page of content. */
const PRINT_SLACK = 32;
await page.pdf({
  path: pdfPath,
  printBackground: true,
  // One tall page, matching the scroll. A map is a map — paginating it would
  // cut journeys in half at arbitrary points. /96 is CSS px to inches.
  width: `${size.width / 96}in`,
  height: `${(size.height + PRINT_SLACK) / 96}in`,
  margin: { top: '0in', right: '0in', bottom: '0in', left: '0in' },
  pageRanges: '1',
});

await browser.close();

console.log(`  ${path.relative(DECK_ROOT, pngPath)}  (${size.width}×${size.height})`);
console.log(`  ${path.relative(DECK_ROOT, pdfPath)}`);
