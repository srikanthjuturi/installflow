/**
 * The languages the app speaks, in the order the picker lists them.
 *
 * English first: it is the file every other one is translated from, and the
 * fallback for any string a translation has not caught up with yet.
 *
 * `nativeName` is what the picker shows, in its own script — somebody looking
 * for Telugu is looking for తెలుగు, not for the English word. `englishName`
 * sits underneath it for whoever is helping them.
 *
 * Listing a language here only fixes its name and its place in the list. It
 * reaches the picker when its translation file is registered in `index.ts`.
 */
export const LANGUAGES = [
  { code: 'en', nativeName: 'English', englishName: 'English' },
  { code: 'hi', nativeName: 'हिन्दी', englishName: 'Hindi' },
  { code: 'te', nativeName: 'తెలుగు', englishName: 'Telugu' },
  { code: 'kn', nativeName: 'ಕನ್ನಡ', englishName: 'Kannada' },
  { code: 'ta', nativeName: 'தமிழ்', englishName: 'Tamil' },
] as const;

export type Language = (typeof LANGUAGES)[number]['code'];

/**
 * Scripts with vowel signs above and below the letter. `ui/Text` gives these
 * the line height they need, and drops letter-spacing, which breaks the line
 * that joins Hindi letters and spaces the others unevenly.
 */
export const INDIC_LANGUAGES: ReadonlySet<Language> = new Set<Language>(['hi', 'te', 'kn', 'ta']);
