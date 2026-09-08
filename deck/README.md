# Client deliverables

Three files, all assembled from the same set of real screenshots of the running
product:

| File | What it is |
|---|---|
| `dist/Reliance GreenTech - Product Overview.pptx` | The pitch deck. One slide per step of the flow, a 3–6 word headline, and the screen doing the talking. |
| `dist/Reliance GreenTech - Screen Catalogue.pptx` | The slide-by-slide leave-behind. Every screen, grouped by who uses it. |
| `dist/Reliance GreenTech - How It Works.docx` / `.pdf` | The explanatory document — for a client to read alone and come away understanding the whole product. |

The decks and the document are deliberately opposite in register. A deck is
low-text because somebody is talking over it; the document has to do the talking
itself, so it leads with plain language, follows **one job** the whole way
through using the demo system's real figures, and puts the detail underneath
rather than in place of the explanation.

This is a **tool, not shipped code**. It is wired into neither `adminWeb/` nor
`mobileapp/`, and nothing in it is deployed.

## The whole thing, from nothing

```bash
cd deck
npm install                                                    # Playwright
.venv/Scripts/python.exe -m pip install -r requirements.txt    # python-pptx

node seed/seed_dev.mjs --reset          # build the demo tenant on DEVELOPMENT
npm run capture                         # all four surfaces → out/png

.venv/Scripts/python.exe build/build_deck.py       # → the two .pptx decks
.venv/Scripts/python.exe build/build_document.py   # → the .docx document
powershell -File build/export_pdf.ps1 -Docx "dist\Reliance GreenTech - How It Works.docx"
```

Three servers must be up first:

```bash
cd api      && ./.venv/Scripts/python.exe run.py    # :8000, development — its own default
cd adminWeb && npm run dev                          # :5173
cd mobileapp && npm run web                         # :8081
```

`npm run capture:prototype` / `:console` / `:mobile` / `:customer` re-shoot one
surface; the manifest is merged, not replaced, so the others survive.

## Everything is captured against a seeded DEVELOPMENT tenant

`seed/seed_dev.mjs` builds a whole company through the real API — staff, a vendor
with its own login, three technicians, a priced catalogue, and thirteen tickets
driven to seven different points of the lifecycle, so the dashboard counts
something, the escalation queue has a row, the ledger holds both a payout and a
penalty, the pool has work in it, and both customer-facing pages have live
tokens.

**Every write goes through the endpoints, never SQL.** That is the point: the API
stamps both prices and the rules snapshot at intake and writes a `ticket_events`
row in the same transaction as the change it describes. Rows inserted behind its
back would look right on a screen and be wrong underneath.

Everything invented lives in `seed/fixtures.mjs`. Change `COMPANY.name` there and
the whole deck re-brands — the console rail, the customer's slot page and the
technician app all read it from the tenant, which is the white-labelling this
product is built around.

### Why development and not production

- **No customer PII.** Every customer is invented, so nothing real can reach a
  slide. The masking layer in `capture/lib/mask.mjs` is therefore switched off
  for these runs — rewriting invented names into other invented names would only
  churn the deck between runs.
- **The customer pages are reachable at all.** Both are opened by a single-use
  token that arrives over WhatsApp. Producing one in production means messaging a
  real customer; opening an existing one risks spending somebody's pending
  confirmation.
- **The technician app can sign in.** Production has `OTP_DEV_ECHO=false` and an
  empty `WHATSAPP_ALLOWLIST`, so asking it for an OTP sends a real message to a
  real technician. Locally the code comes back as `devCode`, and the seeded
  numbers sit outside the allowlist so the send is dropped. Nobody is messaged.

Seeded addresses are all on `@meridian-demo.in`, deliberately **not** on
`ACS_EMAIL_ALLOWLIST`. The send is refused, which is what we want twice over:
nobody is emailed, and the API returns the temporary password in the response
instead of swallowing it. Every account is then set to `Test@123`; technicians
have no password at all, because the phone is the credential.

### The guard is still on

`capture/lib/guard.mjs` installs a `page.route` on every context that aborts any
non-GET to the API except signing in, and `assertNoWrites()` fails the run if
anything tried. It is what stops a stray click changing a job's state between one
screenshot and the next — and it means pointing `DECK_CONSOLE_URL` at the
deployed console is safe, at which point masking switches back on by itself.

## Re-running

`node seed/seed_dev.mjs --reset` replaces the tenant. It has to take the previous
one down in the order the unique constraints require: a technician's phone is an
identity (`uq_users_phone_technician`, partial on `role = 'technician'`) and
outlives the company, so the technicians and their user rows go first. Every
UNIQUE here is partial on `deleted_at IS NULL`, which is exactly why deleting the
rows frees the values rather than burying them.

Two captures **spend** what they photograph, so re-run the seed before repeating
them: confirming a slot uses that ticket's token, which is why the seeder leaves
two tickets waiting rather than one. The feedback form is deliberately **not**
submitted, so that token survives.

## Two web bugs this work fixed

Both were real defects in `mobileapp`, not deck problems — `npm run web` was
broken for everyone:

- **`metro.config.js`** — Zustand's exports map has no `web` condition, so web
  resolved its ESM build, which reads `import.meta.env.MODE`. Metro serves the
  web bundle as a classic script, where `import.meta` is a syntax error, so the
  whole bundle failed to execute and the page rendered blank. Now mapped to the
  CJS files for web only. ⚠ The wrapper must be applied **after**
  `withNativeWind`, which installs a `resolveRequest` of its own.
- **`usePushRegistration.ts`** — two effects registered `expo-notifications`
  listeners with no web guard. Those throw rather than no-op, and a throw inside
  an effect takes the whole screen down behind a red box.

## Editing the deliverables

- **The document's writing** — `build/build_document.py`. The prose is the
  deliverable, so it lives inline as readable text rather than in a data file,
  with `build/docx_kit.py` holding the page furniture (headings, tables,
  callouts, figure rows, captions).
- **The deck narrative** — `build/storyboard.py`. Slides name shot ids, so one
  slide can hold four phones without the capture code knowing anything about
  layout.
- **Which screens are captured** — the `SCREENS` tables at the top of each
  `capture/*.mjs`.
- **Colours, type, geometry** — `build/theme.py`, taken from the product's own
  palette so the deck matches the screenshots on it.
- **Slide shapes** — `build/layouts.py`. Six layouts, and the rule that a
  screenshot slide carries a headline and at most one supporting line. No
  bullets. A `phone-raw` shot gets a device shell drawn on the slide, so live-app
  screens sit beside the prototype's pre-framed ones without looking like an
  afterthought.

A slide whose screenshot is missing is skipped with a warning rather than failing
the build, and every skip is named in the summary.

## What comes from the prototype, and why

The proof cameras and the AI-verification screens come from
`mobileapp/appdesign/Technician Field App.html`. A headless browser has no
camera, and a synthetic test pattern on a client slide looks like a bug; the AI
screens are built but deliberately unwired in v1. Everything else in the
technician section is the running app.

## Checking the result without opening PowerPoint

```powershell
powershell -File build/render_preview.ps1 -Deck "dist\Reliance GreenTech - Product Overview.pptx" -Out "out\preview"
```

Exports every slide to PNG through PowerPoint COM. It never saves the deck.

## Credentials

`seed/seed_dev.mjs` writes them to `seed/credentials.json` and appends the block
the capture needs to `deck/.env`. Both are git-ignored. `.env.example` documents
every variable, including the ones for pointing at the deployed console instead.
