# App languages

The technician app speaks English, हिन्दी, తెలుగు, ಕನ್ನಡ and தமிழ். A technician picks one
once — the list opens by itself on first launch, and again from the 🌐 button on sign-in or
Profile → Language — and every screen switches at once.

```
locales/en.json   the source. Every key the app uses, in approved English.
locales/hi.json   Hindi     ┐
locales/te.json   Telugu    │ the same keys, translated.
locales/kn.json   Kannada   │ `npm run lint` fails if one drifts from en.json.
locales/ta.json   Tamil     ┘
index.ts          i18next setup; a language reaches the picker by being registered here
languages.ts      the list the picker shows, in order, with each name in its own script
errorText.ts      a failure's sentence in the app's language (see "Server text")
serverLabels.ts   the server's fixed English labels, translated
```

## Adding a string

1. Add the English to `locales/en.json`, under the area and screen it belongs to:
   `jobs.detail.call`, `payout.fields.upiId`. `common.*` is only for the same words doing
   the same job in several places (Cancel, Try again).
2. Render it with `const { t } = useTranslation()` and `t('jobs.detail.call')`. A wrong key
   fails `npm run typecheck`.
3. Add the same key to the four other files. English copied in is acceptable for a moment —
   `npm run i18n:check -- --verbose` lists strings still identical to English — but it ships
   as English on a Telugu screen until somebody translates it.
4. `npm run lint` checks that every file has exactly English's keys, placeholders and tags.

Rules that keep a translation possible:

- **Whole sentences are keys.** Never build a sentence from translated words — "the customer"
  changes form with its place in a sentence, in every language. Two sentences (with a name,
  without one) beat one sentence with a word spliced in.
- **Placeholders, not concatenation:** `"Paid by {{name}} · {{when}}"`. A translation may move
  a placeholder; it must keep it.
- **Counts are plurals:** `newJobs_one` / `newJobs_other`, rendered with `t('…', { count })`.
- **Bold or a link inside a sentence is a `<Trans>` key** with named tags —
  `"Enter the code sent to <bold>{{phone}}</bold>. <change>Change</change>"`. Never `<b>` or
  `<strong>`: React Native cannot render HTML tags.
- **`t()` runs while rendering, never at module scope.** A constant map holds keys
  (`STATE_PILL`, `STEP_CONFIG`) and the screen calls `t()` on them. A label built when data is
  fetched or an error is caught would stay in that language after a switch — which is why
  dates are formatted at render (`utils/date.ts`) and errors are stored as the error itself.
- **Every component that shows words calls `useTranslation()` itself**, so a switch re-renders
  it even inside a memoised list row.

## Server text

The API writes in English. What the app can translate, it does:

- **Errors** go through `errorText(error, fallback)`. In English it shows the server's own
  sentence, exactly as before. In other languages it shows `errors.code.<CODE>` when the
  server sent a code, and otherwise the server's English — specific beats generic.
- **Fixed labels** — penalty bands, service types, role names, ledger titles — go through
  `serverLabels.ts`, keyed by the server's English. A label not in its table shows as sent.
- **Never translated:** server status words (they are lookup keys), category, model and spec
  names, people's names, anything somebody typed. And a cancellation reason is shown
  translated but POSTED in English — the ops trail and the console read it in English.

**Push notifications** are written by the server in the phone's language: the app sends the
language on screen with its push token, on every launch and whenever it changes
(`usePushRegistration`), and the API words each push per phone from `api/app/core/push_text.py`.
A new push needs its wording there, in all five languages, following this guide.
**WhatsApp messages** are Meta templates and stay English until each is approved per language.

## Writing a translation

For technicians in the field, reading at a glance, often outdoors.

- **Everyday words, said politely.** The polite "you" — आप / మీరు / ನೀವು / நீங்கள் — and the
  words a technician actually uses, not textbook or literary ones. Clear beats formal.
- **Keep as they are, in Latin letters:** OTP, UPI, UPI ID, QR, UTR, SLA, ID, AM/PM, ₹, the
  digits 0–9, WhatsApp, job codes (RGT-INST-0012), and brand, model and category names.
- **Short where the screen is short** — buttons, tabs, pills, badges. Aim for no more than
  about a third longer than the English; a pill that wraps breaks its card.
- **Punctuation stays:** the `·` separators, `—` dashes, `–` in ranges, `…`, `₹`.
- **English capitals mean nothing here.** An English label in CAPITALS ("SERIAL NO.") is
  written normally in the other scripts.
- **Plurals:** Hindi and Kannada use `_one` for both 0 and 1; Telugu and Tamil only for 1.
  Write each `_one` so it reads right for the numbers it covers.
- **Dates:** `dates.*` holds month and weekday names (Sunday first; the calendar's initials
  are Monday first) and the order the parts go in. Keep AM/PM as they are.

### Glossary

The terms every screen must say the same way. Change one here first, then everywhere.

| English | हिन्दी | తెలుగు | ಕನ್ನಡ | தமிழ் |
|---|---|---|---|---|
| Job | काम | పని | ಕೆಲಸ | வேலை |
| Open job pool (jobs to accept) | उपलब्ध काम | అందుబాటులో ఉన్న పనులు | ಲಭ್ಯವಿರುವ ಕೆಲಸಗಳು | கிடைக்கும் வேலைகள் |
| Accept | स्वीकार करें | అంగీకరించండి | ಸ್ವೀಕರಿಸಿ | ஏற்கவும் |
| Start job | काम शुरू करें | పని ప్రారంభించండి | ಕೆಲಸ ಪ್ರಾರಂಭಿಸಿ | வேலையைத் தொடங்கவும் |
| Cancel | रद्द करें | రద్దు చేయండి | ರದ್ದುಮಾಡಿ | ரத்துசெய் |
| Customer | ग्राहक | కస్టమర్ | ಗ್ರಾಹಕ | வாடிக்கையாளர் |
| Slot / time | समय | సమయం | ಸಮಯ | நேரம் |
| Reschedule | समय बदलें | సమయం మార్చండి | ಸಮಯ ಬದಲಾಯಿಸಿ | நேரத்தை மாற்றவும் |
| Earnings | कमाई | సంపాదన | ಗಳಿಕೆ | வருமானம் |
| Payout (what a job pays) | भुगतान | చెల్లింపు | ಪಾವತಿ | ஊதியம் |
| Penalty | जुर्माना | జరిమానా | ದಂಡ | அபராதம் |
| Bonus | बोनस | బోనస్ | ಬೋನಸ್ | போனஸ் |
| Redeem | रिडीम करें | రీడీమ్ చేయండి | ರಿಡೀಮ್ ಮಾಡಿ | ரிடீம் செய்யவும் |
| Payout account | भुगतान खाता | చెల్లింపు ఖాతా | ಪಾವತಿ ಖಾತೆ | பணம் பெறும் கணக்கு |
| Proof | प्रमाण | రుజువు | ಪುರಾವೆ | சான்று |
| Serial number | सीरियल नंबर | సీరియల్ నంబర్ | ಸೀರಿಯಲ್ ನಂಬರ್ | சீரியல் எண் |
| Barcode | बारकोड | బార్‌కోడ్ | ಬಾರ್‌ಕೋಡ್ | பார்கோடு |
| Photo | फ़ोटो | ఫోటో | ಫೋಟೋ | புகைப்படம் |
| Location | लोकेशन | లొకేషన్ | ಸ್ಥಳ | இருப்பிடம் |
| Pincode | पिनकोड | పిన్‌కోడ్ | ಪಿನ್‌ಕೋಡ್ | பின்கோடு |
| Category | कैटेगरी | కేటగిరీ | ವರ್ಗ | வகை |
| Manager / Area Service Manager (ASM) | मैनेजर / एरिया सर्विस मैनेजर (ASM) | మేనేజర్ / ఏరియా సర్వీస్ మేనేజర్ (ASM) | ಮ್ಯಾನೇಜರ್ / ಏರಿಯಾ ಸರ್ವೀಸ್ ಮ್ಯಾನೇಜರ್ (ASM) | மேனேஜர் / ஏரியா சர்வீஸ் மேனேஜர் (ASM) |
| Online / Offline | ऑनलाइन / ऑफ़लाइन | ఆన్‌లైన్ / ఆఫ్‌లైన్ | ಆನ್‌ಲೈನ್ / ಆಫ್‌ಲೈನ್ | ஆன்லைன் / ஆஃப்லைன் |
| Today | आज | ఈరోజు | ಇಂದು | இன்று |
| Sign in | साइन इन | సైన్ ఇన్ | ಸೈನ್ ಇನ್ | உள்நுழை |
| Profile | प्रोफ़ाइल | ప్రొఫైల్ | ಪ್ರೊಫೈಲ್ | சுயவிவரம் |
| Language | भाषा | భాష | ಭಾಷೆ | மொழி |
| Settings (the phone's) | सेटिंग्स | సెట్టింగ్‌లు | ಸೆಟ್ಟಿಂಗ್‌ಗಳು | அமைப்புகள் |

### Review

Every translation here is a first draft, written to this guide. Before a language reaches a
production build, a native speaker should read it on a real phone — the screens, not the
file — and any fix is an edit to that language's JSON, nothing else.

| Language | Reviewed by | Date |
|---|---|---|
| हिन्दी | — | — |
| తెలుగు | — | — |
| ಕನ್ನಡ | — | — |
| தமிழ் | — | — |
