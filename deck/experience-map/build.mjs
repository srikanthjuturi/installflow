/**
 * Build the product experience map into `out/experience-map/`.
 *
 *     node experience-map/build.mjs
 *
 * Emits `index.html` beside a `shots/` folder of the PNGs it references, so the
 * same directory can be opened locally, rendered to PNG/PDF by `render.mjs`, or
 * published as an Artifact with `shots/*` as its supporting files.
 *
 * ## Where the words come from
 *
 * Every headline, caption and supporting line is PULLED. Screen captions come
 * from `out/shots.json`, which the capture scripts write; act and journey
 * headings come from `journeys.mjs`, which takes them verbatim from
 * `build/build_document.py`. Nothing is invented here, which is the repo's
 * "never invent copy" rule applied to a client-facing artifact.
 *
 * ## Why it reads the manifest instead of listing files
 *
 * The previous draft hard-coded eight paths into the Play-Store listing folder
 * and never touched the 61 captured product screens, so four of the five
 * parties never appeared on it. Reading `shots.json` means a re-capture
 * refreshes the map for free, and a shot that is named but missing is a loud
 * failure rather than a silently absent picture.
 */

import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTS, ACTORS, CLOSING, DEMO_NOTE } from './journeys.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DECK_ROOT = path.resolve(HERE, '..');
const SHOTS_JSON = path.join(DECK_ROOT, 'out', 'shots.json');
const OUT_DIR = path.join(DECK_ROOT, 'out', 'experience-map');

/** Escape for HTML text and attribute values. */
const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * A `phone-raw` shot is a bare viewport and needs a device shell drawn around
 * it; a `phone` shot came out of the prototype with one already in the pixels.
 * Getting this backwards is the single fastest way to make the page look wrong
 * — either a bezel inside a bezel, or a screenshot floating with no edge.
 *
 * The proportions are the ones `build/layouts.py` uses for the decks, so the
 * two deliverables draw the same device: an 11px bezel and a 44px corner on a
 * 392pt-wide frame.
 */
const FRAME = { bezel: 11 / 392, radius: 44 / 392 };

function today() {
  // Passed in rather than read from the clock, so a rebuild of an unchanged
  // map is byte-identical. `render.mjs` and CI both leave it unset.
  const stamp = process.env.DECK_DATE;
  if (stamp) return stamp;
  const now = new Date();
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
}

function screenMarkup(shot) {
  const framed = shot.kind !== 'phone-raw';
  const isPhone = shot.kind !== 'console';
  const classes = ['screen', isPhone ? 'is-phone' : 'is-console'];
  if (isPhone && !framed) classes.push('needs-shell');

  const caption = shot.title
    ? `<figcaption class="cap"><span class="cap-title">${esc(shot.title)}</span>${
        shot.sub ? `<span class="cap-sub">${esc(shot.sub)}</span>` : ''
      }</figcaption>`
    : '';

  return `
        <figure class="${classes.join(' ')}">
          <button class="shot" type="button"
                  data-full="shots/${esc(shot.id)}.png"
                  data-title="${esc(shot.title || shot.id)}"
                  aria-label="Enlarge: ${esc(shot.title || shot.id)}">
            <img src="shots/${esc(shot.id)}.png" alt="${esc(shot.title || shot.id)}"
                 width="${shot.kind === 'console' ? 3200 : 1176}"
                 height="${shot.kind === 'console' ? 2000 : 2436}" loading="eager" />
          </button>
          ${caption}
        </figure>`;
}

function journeyMarkup(journey, shots, missing) {
  const actor = ACTORS[journey.actor];
  const rows = journey.shots
    .map((id) => {
      const shot = shots.get(id);
      if (!shot) {
        missing.push(id);
        return '';
      }
      return screenMarkup(shot);
    })
    .join('');

  const marker = journey.step
    ? `<span class="step" aria-hidden="true">${journey.step}</span>`
    : `<span class="dot" aria-hidden="true"></span>`;

  return `
      <section class="journey" style="--tint:${actor.tint}">
        <header class="journey-head">
          ${marker}
          <h3>${esc(journey.title)}</h3>
          <p class="actor">${esc(actor.label)}</p>
        </header>
        <div class="screens">${rows}
        </div>
      </section>`;
}

function actMarkup(act, shots, missing) {
  return `
    <section class="act${act.unbuilt ? ' act-unbuilt' : ''}" id="${esc(act.id)}">
      <header class="act-head">
        <p class="eyebrow">${esc(act.eyebrow)}</p>
        <h2>${esc(act.title).replace(/\n/g, '<br />')}</h2>
        <p class="lede">${esc(act.lede)}</p>
      </header>
      ${act.journeys.map((j) => journeyMarkup(j, shots, missing)).join('')}
    </section>`;
}

function page({ acts, counts, stamp }) {
  return `<title>Installation and Demo</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,400;0,500;0,700;0,900&family=Roboto+Mono:wght@500&display=swap" />
<style>
  /* ── Tokens ────────────────────────────────────────────────────────────
     Taken from deck/build/theme.py, which is itself taken from the product's
     own palette: the ink and page colours are the ones the customer-facing
     pages set inline, and the accent is the blue both clients use for a
     primary action. A map that does not match the screenshots on it looks
     like somebody else's map. */
  :root {
    --ink: #141b22;
    --ink-soft: #5a6772;
    --page: #eef1f3;
    --paper: #ffffff;
    --border: #e2e8ee;
    --rule: #d5dde4;
    --accent: #1f6feb;
    --accent-soft: #e4efff;
    --success: #14683a;
    --shadow-card: 0 1px 2px rgb(20 24 40 / .06), 0 1px 3px rgb(20 24 40 / .04);
    --shadow-lift: 0 18px 44px rgb(20 27 34 / .16);
    --gutter: clamp(16px, 4vw, 56px);
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ink: #e8edf2;
      --ink-soft: #93a2b0;
      --page: #0f151b;
      --paper: #18212a;
      --border: #26313c;
      --rule: #2d3945;
      --accent: #4d92ff;
      --accent-soft: #16273f;
      --success: #5fc98d;
      --shadow-card: 0 1px 2px rgb(0 0 0 / .5);
      --shadow-lift: 0 18px 44px rgb(0 0 0 / .6);
    }
  }
  :root[data-theme="dark"] {
    --ink: #e8edf2;
    --ink-soft: #93a2b0;
    --page: #0f151b;
    --paper: #18212a;
    --border: #26313c;
    --rule: #2d3945;
    --accent: #4d92ff;
    --accent-soft: #16273f;
    --success: #5fc98d;
    --shadow-card: 0 1px 2px rgb(0 0 0 / .5);
    --shadow-lift: 0 18px 44px rgb(0 0 0 / .6);
  }

  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--page);
    color: var(--ink);
    font-family: Roboto, "Segoe UI", system-ui, sans-serif;
    font-size: 16px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { padding-inline: var(--gutter); padding-block: 0; }

  /* ── Masthead ─────────────────────────────────────────────────────────── */
  .masthead {
    max-width: 1680px; margin: 0 auto;
    padding-block: clamp(40px, 7vw, 96px) clamp(28px, 4vw, 48px);
    display: grid; gap: 28px;
  }
  .eyebrow {
    margin: 0; font-size: 12px; font-weight: 700; letter-spacing: .14em;
    text-transform: uppercase; color: var(--ink-soft);
  }
  .masthead h1 {
    margin: 0; font-weight: 900; letter-spacing: -.025em;
    font-size: clamp(38px, 7vw, 82px); line-height: 1.02;
    text-wrap: balance; max-width: 16ch;
  }
  .masthead .lede {
    margin: 0; max-width: 54ch; font-size: clamp(16px, 1.5vw, 20px);
    color: var(--ink-soft);
  }
  .facts { display: flex; flex-wrap: wrap; gap: 10px; margin: 0; padding: 0; list-style: none; }
  .facts li {
    display: flex; align-items: baseline; gap: 7px;
    background: var(--paper); border: 1px solid var(--border);
    border-radius: 999px; padding: 7px 15px;
    font-size: 13px; color: var(--ink-soft);
    box-shadow: var(--shadow-card);
  }
  .facts b {
    font-weight: 900; font-size: 15px; color: var(--ink);
    font-variant-numeric: tabular-nums;
  }

  /* ── Legend: the one piece of notation the map uses ───────────────────── */
  .legend {
    max-width: 1680px; margin: 0 auto; padding-block: 0 clamp(24px, 3vw, 40px);
    display: flex; flex-wrap: wrap; gap: 8px 22px; align-items: center;
    border-top: 1px solid var(--rule); padding-top: 22px;
  }
  .legend p { margin: 0; font-size: 13px; color: var(--ink-soft); }
  .legend ul { display: flex; flex-wrap: wrap; gap: 8px 18px; margin: 0; padding: 0; list-style: none; }
  .legend li { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink-soft); }
  .legend .swatch { width: 11px; height: 11px; border-radius: 3px; flex: none; }

  /* ── Acts ─────────────────────────────────────────────────────────────── */
  .act { max-width: 1680px; margin: 0 auto; padding-block: clamp(44px, 6vw, 88px) 0; }
  .act-head { max-width: 62ch; display: grid; gap: 14px; margin-bottom: clamp(28px, 4vw, 52px); }
  .act-head h2 {
    margin: 0; font-weight: 900; letter-spacing: -.02em;
    font-size: clamp(28px, 4vw, 50px); line-height: 1.06; text-wrap: balance;
  }
  .act-head .lede { margin: 0; color: var(--ink-soft); font-size: clamp(15px, 1.4vw, 18px); max-width: 56ch; }

  /* The spine. A hairline the journeys hang from — the only connective
     device on the page, and it carries the actor's colour rather than an
     arrowhead, so a hand-off between parties reads as a change of hue. */
  .journey {
    display: grid; grid-template-columns: minmax(200px, 250px) 1fr;
    gap: clamp(20px, 3vw, 48px);
    padding-block: clamp(22px, 3vw, 40px);
    border-top: 1px solid var(--rule);
    position: relative;
  }
  .journey::before {
    content: ""; position: absolute; left: 0; top: -1px; width: 62px; height: 2px;
    background: var(--tint);
  }
  .journey-head { align-self: start; display: grid; gap: 9px; }
  .journey-head h3 {
    margin: 0; font-weight: 900; font-size: clamp(19px, 1.8vw, 25px);
    line-height: 1.18; letter-spacing: -.012em; text-wrap: balance;
  }
  .step {
    display: inline-grid; place-items: center; width: 38px; height: 38px;
    border-radius: 50%; background: var(--tint); color: #fff;
    font-weight: 900; font-size: 17px; font-variant-numeric: tabular-nums;
  }
  .dot { width: 11px; height: 11px; border-radius: 50%; background: var(--tint); }
  .actor {
    margin: 0; font-size: 12px; font-weight: 700; letter-spacing: .11em;
    text-transform: uppercase; color: var(--tint);
  }

  /* ── Screens ──────────────────────────────────────────────────────────── */
  .screens { display: flex; flex-wrap: wrap; gap: clamp(16px, 2vw, 30px); align-items: flex-start; }
  .screen { margin: 0; display: grid; gap: 10px; }
  /* Sized so the UI inside is actually legible. The previous map drew phones
     at 210-286px inside an 1800px canvas, which put the product's own screens
     below the threshold where anything on them could be read — the one thing a
     screenshot-led map has to get right. */
  .screen.is-phone { flex: 0 1 264px; max-width: 264px; }
  /* A console shot is 8:5 and full of small type, so it gets roughly half the
     row to itself and never shrinks below a readable width. */
  .screen.is-console { flex: 1 1 640px; max-width: 900px; min-width: 0; }

  .shot {
    display: block; width: 100%; padding: 0; border: 0; background: none;
    cursor: zoom-in; border-radius: 14px;
  }
  .shot img { display: block; width: 100%; height: auto; border-radius: 12px; }

  /* A console screenshot is near-white on the right and a dark rail on the
     left, so it needs a plate and a hairline or half of it dissolves into the
     page while the other half does not. */
  .is-console .shot img {
    background: var(--paper);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-card);
  }

  /* The device shell, drawn ONLY for a bare viewport. Prototype shots already
     carry one in their pixels. */
  .needs-shell .shot img {
    background: var(--ink);
    padding: calc(100% * ${FRAME.bezel});
    border-radius: calc(100% * ${FRAME.radius} / 2);
    box-shadow: var(--shadow-lift);
  }
  .is-phone:not(.needs-shell) .shot img { box-shadow: var(--shadow-lift); border-radius: 18px; }

  .shot:focus-visible { outline: 3px solid var(--accent); outline-offset: 4px; }

  .cap { display: grid; gap: 2px; }
  .cap-title { font-size: 13.5px; font-weight: 700; line-height: 1.3; }
  .cap-sub { font-size: 12.5px; color: var(--ink-soft); line-height: 1.35; }

  /* ── Not-built act: same structure, visibly held apart ─────────────────── */
  .act-unbuilt .act-head { position: relative; padding-left: 18px; }
  .act-unbuilt .act-head::before {
    content: ""; position: absolute; left: 0; top: 4px; bottom: 4px; width: 3px;
    background: var(--ink-soft); border-radius: 2px;
  }
  .act-unbuilt .screen { opacity: .72; }
  .act-unbuilt .screens { filter: saturate(.55); }

  /* ── Closing ──────────────────────────────────────────────────────────── */
  .closing {
    max-width: 1680px; margin: clamp(48px, 6vw, 92px) auto 0;
    background: var(--ink); color: var(--page);
    border-radius: 26px; padding: clamp(30px, 4vw, 60px);
    display: grid; gap: 26px;
  }
  :root[data-theme="dark"] .closing,
  .closing { color: #e8edf2; }
  .closing h2 {
    margin: 0; font-weight: 900; font-size: clamp(25px, 3.4vw, 42px);
    line-height: 1.08; letter-spacing: -.02em; text-wrap: balance;
  }
  .closing ol { margin: 0; padding: 0; list-style: none; display: grid; gap: 14px; counter-reset: c; }
  .closing li {
    display: grid; grid-template-columns: 30px 1fr; gap: 14px; align-items: start;
    font-size: clamp(15px, 1.4vw, 18px); color: #cbd6e0;
  }
  .closing li::before {
    counter-increment: c; content: counter(c);
    display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%;
    background: rgb(255 255 255 / .11); color: #fff; font-size: 13px; font-weight: 900;
  }
  .note {
    max-width: 1680px; margin: 22px auto 0; font-size: 13px; color: var(--ink-soft);
    max-width: 78ch;
  }
  .colophon {
    max-width: 1680px; margin: 0 auto; padding-block: 26px clamp(36px, 5vw, 64px);
    display: flex; flex-wrap: wrap; gap: 6px 16px; justify-content: space-between;
    font-size: 12px; color: var(--ink-soft); border-top: 1px solid var(--rule); margin-top: 26px;
  }
  .colophon .mono { font-family: "Roboto Mono", ui-monospace, monospace; }

  /* ── Lightbox: what makes seventy screens legible ─────────────────────── */
  .viewer {
    position: fixed; inset: 0; z-index: 50; border: 0; padding: 0; margin: 0;
    width: 100%; height: 100%; max-width: none; max-height: none;
    background: rgb(10 14 18 / .93);
    display: grid; grid-template-rows: auto 1fr; gap: 12px;
  }
  .viewer::backdrop { background: rgb(10 14 18 / .93); }
  /* A closed dialog is display:none by UA default — and the .viewer rule above
     overrides it, which paints the whole ground over the masthead at rest.
     Restore it explicitly: display is the one property a dialog's open state
     depends on. (No backticks in this file's CSS — it is a template literal.) */
  .viewer:not([open]) { display: none !important; }
  .viewer[hidden] { display: none !important; }
  .viewer-bar {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 14px calc(14px + env(safe-area-inset-right, 0px)) 0 calc(14px + env(safe-area-inset-left, 0px));
    color: #e8edf2; font-size: 13.5px; font-weight: 700;
  }
  .viewer-bar button {
    border: 1px solid rgb(255 255 255 / .28); background: rgb(255 255 255 / .08);
    color: #fff; border-radius: 999px; padding: 7px 15px; font: inherit; cursor: pointer;
  }
  .viewer-bar button:hover { background: rgb(255 255 255 / .16); }
  .viewer img {
    place-self: center; max-width: calc(100% - 28px); max-height: calc(100% - 28px);
    width: auto; height: auto; border-radius: 10px; margin-bottom: 14px;
  }

  @media (max-width: 860px) {
    .journey { grid-template-columns: 1fr; }
    .journey-head { grid-template-columns: auto auto 1fr; align-items: center; gap: 12px; }
    .journey-head h3 { grid-column: 1 / -1; }
    .screen.is-console { flex-basis: 100%; }
  }
  @media (prefers-reduced-motion: reduce) {
    * { animation: none !important; transition: none !important; }
  }
</style>

<div class="wrap">
  <header class="masthead">
    <p class="eyebrow">Installation &amp; Demo platform</p>
    <h1>One job, five parties, no step taken on trust</h1>
    <p class="lede">From the vendor&rsquo;s ticket to the customer&rsquo;s confirmation &mdash; with proof at every step. Every screen below is the running product.</p>
    <ul class="facts">
      <li><b>${counts.screens}</b> screens</li>
      <li><b>${counts.journeys}</b> journeys</li>
      <li><b>5</b> parties</li>
      <li><b>4</b> proofs per job</li>
    </ul>
  </header>

  <div class="legend">
    <p>Colour names who is on screen:</p>
    <ul>
      ${Object.values(ACTORS)
        .map(
          (a) =>
            `<li><span class="swatch" style="background:${a.tint}"></span>${esc(a.label)}</li>`,
        )
        .join('\n      ')}
    </ul>
  </div>

  ${acts}

  <section class="closing">
    <h2>${esc(CLOSING.title)}</h2>
    <ol>
      ${CLOSING.lines.map((line) => `<li>${esc(line)}</li>`).join('\n      ')}
    </ol>
  </section>

  <p class="note">${esc(DEMO_NOTE)}</p>

  <footer class="colophon">
    <span>Installation &amp; Demo platform &mdash; product experience map</span>
    <span class="mono">${esc(counts.screens)} screens &middot; ${esc(stamp)}</span>
  </footer>
</div>

<dialog class="viewer" id="viewer" aria-label="Enlarged screen">
  <div class="viewer-bar">
    <span id="viewer-title"></span>
    <button type="button" id="viewer-close">Close</button>
  </div>
  <img id="viewer-img" src="" alt="" />
</dialog>

<script>
  (function () {
    var dialog = document.getElementById('viewer');
    var image = document.getElementById('viewer-img');
    var label = document.getElementById('viewer-title');
    if (!dialog || !image) return;

    function open(button) {
      image.src = button.getAttribute('data-full');
      image.alt = button.getAttribute('data-title') || '';
      label.textContent = button.getAttribute('data-title') || '';
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    function close() {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      image.src = '';
    }

    document.querySelectorAll('.shot').forEach(function (button) {
      button.addEventListener('click', function () { open(button); });
    });
    document.getElementById('viewer-close').addEventListener('click', close);
    dialog.addEventListener('click', function (event) {
      // Clicking the ground closes; clicking the picture does not.
      if (event.target === dialog) close();
    });
  })();
</script>
`;
}

async function main() {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(SHOTS_JSON, 'utf8'));
  } catch {
    console.error('no out/shots.json — run `npm run capture` first');
    return 1;
  }

  const shots = new Map(manifest.map((shot) => [shot.id, shot]));
  const missing = [];
  const named = ACTS.flatMap((act) => act.journeys.flatMap((j) => j.shots));

  const acts = ACTS.map((act) => actMarkup(act, shots, missing)).join('\n');

  const counts = {
    screens: named.length - missing.length,
    journeys: ACTS.reduce((total, act) => total + act.journeys.length, 0),
  };

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(path.join(OUT_DIR, 'shots'), { recursive: true });

  for (const id of named) {
    const shot = shots.get(id);
    if (!shot) continue;
    await copyFile(
      path.join(DECK_ROOT, shot.file),
      path.join(OUT_DIR, 'shots', `${id}.png`),
    ).catch(() => missing.push(id));
  }

  await writeFile(
    path.join(OUT_DIR, 'index.html'),
    page({ acts, counts, stamp: today() }),
    'utf8',
  );

  /* The same structure, resolved, for anything that cannot import a .mjs —
     `build/build_map_document.py` reads this to lay the map out as a Word
     document. Emitting it here rather than restating the journeys in Python is
     what keeps the two versions from drifting: there is still one source of
     truth, and it is `journeys.mjs`. */
  await writeFile(
    path.join(OUT_DIR, 'journeys.json'),
    `${JSON.stringify(
      {
        stamp: today(),
        actors: ACTORS,
        acts: ACTS.map((act) => ({
          id: act.id,
          eyebrow: act.eyebrow,
          title: act.title,
          lede: act.lede,
          unbuilt: Boolean(act.unbuilt),
          journeys: act.journeys.map((journey) => ({
            step: journey.step ?? null,
            actor: journey.actor,
            actorLabel: ACTORS[journey.actor].label,
            title: journey.title,
            shots: journey.shots
              .filter((id) => shots.has(id))
              .map((id) => {
                const shot = shots.get(id);
                return {
                  id,
                  file: shot.file,
                  title: shot.title,
                  sub: shot.sub,
                  kind: shot.kind,
                };
              }),
          })),
        })),
        closing: CLOSING,
        demoNote: DEMO_NOTE,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log(`${counts.screens} screen(s) across ${counts.journeys} journeys`);
  console.log(`  ${path.relative(DECK_ROOT, OUT_DIR)}/index.html`);

  if (missing.length) {
    const unique = [...new Set(missing)];
    console.log(`\n${unique.length} screen(s) named but not captured:`);
    for (const id of unique) console.log(`  - ${id}`);
    // Same rule as the deck and the document: the page is written either way,
    // and a non-zero status is what stops the render step treating a map with
    // holes in it as finished.
    return 1;
  }
  return 0;
}

process.exitCode = await main();
