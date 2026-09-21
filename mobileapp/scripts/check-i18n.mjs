#!/usr/bin/env node
/**
 * Every translation must have exactly the shape of en.json.
 *
 * TypeScript checks that the app only asks for keys English has. It cannot see
 * inside the other files, so this does, and fails `npm run lint` when:
 *
 *   - a language is missing a key English has, or has one English does not;
 *   - a string's {{placeholders}} differ from English's — a translation that
 *     drops {{amount}} shows a penalty with no number in it;
 *   - a string's <tags> differ — <Trans> would lose the bold or the link;
 *   - a list (month names…) has a different length;
 *   - any string, English included, is empty.
 *
 * Strings identical to English are counted, not failed: "OTP" and "UPI ID"
 * are meant to stay as they are. `--verbose` lists them, as a to-do list for
 * whoever is reviewing a language.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALES = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n', 'locales');
const verbose = process.argv.includes('--verbose');

/** { 'a.b': 'text', 'a.list': ['x', 'y'] } — nested objects flattened, lists kept whole. */
function flatten(node, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value, path, out);
    } else {
      out[path] = value;
    }
  }
  return out;
}

const placeholders = (s) =>
  [...s.matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)].map((m) => m[1]).sort().join(',');
const tags = (s) =>
  [...s.matchAll(/<\s*(\/?)\s*([A-Za-z][\w-]*)\s*(\/?)>/g)]
    .map((m) => `${m[1]}${m[2]}${m[3]}`)
    .sort()
    .join(',');

function load(file) {
  try {
    return flatten(JSON.parse(readFileSync(join(LOCALES, file), 'utf8')));
  } catch (error) {
    console.error(`✗ ${file}: not valid JSON — ${error.message}`);
    process.exit(1);
  }
}

const errors = [];
const en = load('en.json');

for (const [key, value] of Object.entries(en)) {
  const values = Array.isArray(value) ? value : [value];
  if (values.some((v) => typeof v !== 'string' || v.trim() === '')) {
    errors.push(`en: "${key}" is empty or not text`);
  }
}

const others = readdirSync(LOCALES).filter((f) => f.endsWith('.json') && f !== 'en.json');

for (const file of others) {
  const code = file.replace(/\.json$/, '');
  const lang = load(file);
  const same = [];

  for (const key of Object.keys(en)) {
    if (!(key in lang)) errors.push(`${code}: missing "${key}"`);
  }
  for (const [key, value] of Object.entries(lang)) {
    const source = en[key];
    if (source === undefined) {
      errors.push(`${code}: "${key}" is not in en.json`);
      continue;
    }
    if (Array.isArray(source) !== Array.isArray(value)) {
      errors.push(`${code}: "${key}" should be ${Array.isArray(source) ? 'a list' : 'text'}`);
      continue;
    }
    const pairs = Array.isArray(source)
      ? source.map((s, i) => [s, value[i], `${key}[${i}]`])
      : [[source, value, key]];
    if (Array.isArray(source) && source.length !== value.length) {
      errors.push(`${code}: "${key}" has ${value.length} items, English has ${source.length}`);
      continue;
    }
    for (const [from, to, where] of pairs) {
      if (typeof to !== 'string' || to.trim() === '') {
        errors.push(`${code}: "${where}" is empty or not text`);
        continue;
      }
      if (placeholders(from) !== placeholders(to)) {
        errors.push(`${code}: "${where}" placeholders {${placeholders(to)}} ≠ English {${placeholders(from)}}`);
      }
      if (tags(from) !== tags(to)) {
        errors.push(`${code}: "${where}" tags <${tags(to)}> ≠ English <${tags(from)}>`);
      }
      if (from === to) same.push(where);
    }
  }

  const note = `${code}: ${Object.keys(lang).length} keys, ${same.length} identical to English`;
  console.log(verbose && same.length ? `${note}:\n  ${same.join('\n  ')}` : note);
}

if (errors.length) {
  console.error(`\n✗ ${errors.length} translation problem(s):\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log(`✓ translations match en.json (${Object.keys(en).length} keys, ${others.length} other language(s))`);
