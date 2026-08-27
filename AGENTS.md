# Reliance GreenTech Technician Field App

React Native app for technicians doing **installation & demo** jobs — accept a job with a
customer-confirmed slot, travel, install, capture AI-verified photo proof, close the ticket.

> **Expo HAS CHANGED.** Read the exact versioned docs at
> https://docs.expo.dev/versions/v54.0.0/ before writing any code.

Two sources of truth:

- [RequirementDocs/Installation_Requirement_Document.docx](RequirementDocs/Installation_Requirement_Document.docx)
  — the business flow.
- [mobileapp/appdesign/Technician Field App.html](mobileapp/appdesign/) — a clickable prototype
  with all **18 screens**. It is a design artifact with no reusable code, but its copy, layout
  and colours are **approved** — match it exactly. It sits with the app because it is the app's
  design reference, not a requirement the backend shares.

For the per-screen spec, token tables and component patterns, load the **`reliance-greentech-tech-app`**
skill in `mobileapp/.claude/skills/`.

## Phase: partly bound

The API is real for **auth, companies, users, territory, the product master, technician
onboarding, ticket intake and the job pool**. Everything else — my jobs, earnings, escalations,
the ledger, AI review, proof capture — is still typed mock data behind a TanStack Query hook, so
binding each remaining slice stays a one-line change and we keep loading / empty / error states
today.

`mobileapp/src/lib/api.ts` and `adminWeb/src/services/http.ts` are the two transports. Both speak
the same envelope: `{ success, statusCode, message, data, errors }`.

**Do not fake a number that has a real source.** A null rating renders `—`, not `0.0`; job
history renders empty rather than inventing rows; "34 technicians certified" is a `COUNT`.

## Stack

Expo SDK 54 · React Native 0.81 · React 19.1 · TypeScript (strict) · Expo Router ·
NativeWind 4 (Tailwind 3) · TanStack Query · Zustand · React Hook Form + Zod ·
react-native-svg · expo-camera · Roboto via `@expo-google-fonts/roboto`

Everything currently installed runs in **Expo Go**. Do not add third-party native modules
(`react-native-mmkv`, `react-native-keyboard-controller`, Sentry) without flagging it — they
break Expo Go and force a dev-client build.

## Hard rules

### 0. This product is MULTI-TENANT. Applies everywhere, before anything below.

Every company's data is its own. One company's categories, technicians, tickets or users must
never appear in, link to, or be reachable from another's — not in a list, not through a guessed
id, not through a join somebody forgot to scope.

- **Backend:** every tenant table carries `company_id`; every parent/child link is a COMPOSITE
  foreign key on `(company_id, parent_id)`; every query filters on `principal.company_id`; a
  guessed id returns **404, not 403**. Full detail and the enforcement script in `api/AGENTS.md`.
- **Both clients:** the active company comes from the session, never from a URL, a form field or
  a cached list. Never build a request that names a company id the user did not switch to.
- **Seed and demo data:** each company gets its OWN rows. Two companies starting from the same
  starter catalogue is fine; two companies SHARING a row is not.

Run `python -m app.scripts.audit_tenancy` from `api/` after any schema change. It exits non-zero
if isolation is broken, and it found a real gap the day it was written.

---

1. **No hex colours** outside `src/theme/`. Use a NativeWind class (`bg-primary-500`) or import
   `color` from `@/theme/semantic`. ESLint fails the build otherwise.
2. **Screens use semantic roles, not ramp positions.** `color.statusCompleted`, not
   `palette.success[500]`. That indirection is what makes a re-skin one file.
3. **No server state in Zustand.** Jobs, profile, earnings are server state → TanStack Query.
   Zustand holds client state only (session, in-flight capture, online toggle).
4. **`app/` files are routes, not screens.** Keep them ~15 lines: route options plus
   `<JobDetailScreen />`. Real screens live in `src/features/*/screens/`.
5. **Every list screen ships loading, empty and error states.** Not optional.
6. **Never invent copy.** Pull exact strings from the prototype. If it isn't in the prototype,
   ask rather than writing filler.
7. **No dark mode.** v1 is one high-contrast light theme — these screens are used outdoors.
8. **Tailwind class names must be static strings.** An interpolated `bg-${role}-500` is never
   generated and renders transparent.

## Layout

The repo holds more than the app — the Python backend lands beside it later.

```
RequirementDocs/        business flow + the approved prototypes
mobileapp/              the Expo app — ALL technician-app work happens in here
adminWeb/               the Reliance GreenTech ops console (React + Vite) — see adminWeb/AGENTS.md
api/                    the FastAPI backend — auth, tenancy, territory, product master,
                        technician onboarding. Jobs and money are still to come.
                        Has its OWN hard rules — see api/AGENTS.md, tenancy first.
```

## Skill & agent scoping

**A skill lives in the folder it applies to.** Only what is genuinely cross-platform sits at the
repo root; anything tied to React Native or to the DOM is scoped down, so an agent working in one
app never picks up the other's tooling.

```
.claude/skills/             GLOBAL — applies everywhere
  grill-me                    pressure-test a plan (manual /grilling only)
  typescript-advanced-types   pure TS, no platform assumptions
  vercel-composition-patterns React composition; React 19 in both apps
  vercel-react-best-practices React/JS perf. ⚠ its server-*/hydration/DOM rules are web-only
mobileapp/.claude/skills/   MOBILE ONLY
  reliance-greentech-tech-app           the 18-screen spec, tokens, penalty bands, proof state machine
  vercel-react-native-skills  RN performance, navigation, native modules, platform APIs
  expo-native-ui              Expo native UI: lists, modals, tabs, bottom sheets, haptics
  expo-router                 the routing model behind `app/` — see rule 4
  expo-project-structure      file layout conventions for an Expo Router app
  expo-data-fetching          offline caching, background refresh, sync patterns
  expo-upgrade                SDK upgrades: breaking changes, native module compat, migration
adminWeb/.claude/skills/    WEB ONLY — never load these for mobileapp/
  shadcn                      Radix + react-dom; nothing renders in React Native
  tailwind-design-system      Tailwind v4 @theme/@apply. NativeWind 4 is Tailwind 3 — wrong here
  webapp-testing              Playwright against a local HTTP server
  frontend-design             visual judgment. Mobile's design is already approved and locked
api/.claude/skills/         BACKEND ONLY
  publish-api                 deploy to Azure App Service; the ARM gap, Oryx, log reading
```

The same rule governs custom subagents: a mobile-specific agent belongs in
`mobileapp/.claude/agents/`, not at the root. There are none yet.

Each scope owns its own `skills-lock.json` next to that folder. Restore a scope with
`npx skills experimental_install` run **from that folder**. When adding a skill, `cd` into the
right folder first — the CLI installs relative to the working directory. The agent flag is
`-a claude-code` (plain `claude` is rejected); add `-y` to skip the prompt.

**Check a skill targets our versions before installing it.** A skill written for the next major of
the stack is worse than no skill — it argues confidently for the wrong thing. Two were removed for
exactly that: `expo-tailwind-setup` (teaches Tailwind v4 + NativeWind v5 + `react-native-css`;
this app is NativeWind `4.2.6` / Tailwind `3.4.19`, and it would break the `src/theme/tokens.js`
single-source rule) and `sleek-design-mobile-apps` (an API client for a paid design SaaS, not a
knowledge skill). `adminWeb/`'s `tailwind-design-system` is Tailwind **v4** `@theme` syntax and
does not apply to `mobileapp/` either — that is why it is scoped to the web folder.

A skill install can fail **silently** if the name is wrong — the CLI prints no error, it just
installs nothing. Always check `ls .claude/skills/` afterwards. Published display names often
differ from the real skill id (`building-native-ui` → `expo-native-ui`, `native-data-fetching` →
`expo-data-fetching`, `upgrading-expo` → `expo-upgrade`). List the real ids first with
`npx skills add <repo-url> --list`.

Inside `mobileapp/`:

```
app/                    routes only (Expo Router)
  (auth)/               invite · coverage · login
  (app)/(tabs)/         Home · Jobs · Earnings · Profile
  (app)/pool/           job pool · masked offer
  (app)/job/[id]/       detail · cancel · proof/*
src/
  features/<slice>/     screens/ components/ hooks/ types.ts
  theme/                tokens.js ← SINGLE SOURCE · semantic.ts · spacing.ts · typography.ts
  components/           ui/ feedback/ layout/ icons/
  mocks/                seeded mock data
  store/                Zustand (client state only)
```

`src/theme/tokens.js` is plain CJS on purpose — `tailwind.config.js` (Node) and TypeScript both
read that one file, so a colour is never declared twice. Types come from `tokens.d.ts`.

## Commands

**Run these from `mobileapp/`, not the repo root.**

```bash
cd mobileapp
npm start        # expo start — scan the QR with Expo Go
npm run lint     # must pass before every commit
npm run typecheck
npm run doctor
```

The backend and the console have their own:

```bash
cd api
./.venv/Scripts/python.exe run.py                       # uvicorn on :8000
./.venv/Scripts/python.exe -m alembic upgrade head
./.venv/Scripts/python.exe -m app.scripts.bootstrap      # the superadmin

cd adminWeb
npm run dev      # vite; the API must be up for anything to load
```

⚠ **A restart of the API can silently do nothing.** uvicorn's `--reload` runs a child worker, and
on Windows that child can outlive its parent and keep the listening socket on :8000. The new
server then binds alongside it and the ORPHAN keeps answering — with the config it loaded hours or
days ago, so an edited `.env` appears to be ignored. Check for more than one listener before
believing a restart:

```bash
netstat -ano | grep ':8000 .*LISTENING'   # more than one PID = an orphan is serving
taskkill /PID <old-pid> /F
```

**Migrations: always test the round trip** — `upgrade head`, `downgrade <previous>`, `upgrade head`
— before writing service code against a new table. And delete the autogenerated drops of
`uq_companies_gst_lower`, `uq_companies_slug_lower` and `uq_users_email_lower`: Alembic does not
recognise hand-written `LOWER()` functional indexes and mistakes them for stale.

Two schema rules that are easy to miss and expensive to retrofit — both spelled out in
`api/AGENTS.md`: **a UNIQUE on a soft-deleted table is partial on `deleted_at IS NULL`** (or a
hidden row keeps its name forever, and re-adding a removed technician 409s with nothing on screen
to explain it), and **every foreign key gets a covering index** (Postgres makes none, so deleting a
parent scans the whole child table).

### Testing onboarding without Meta credentials

Leave `WHATSAPP_*` empty. Invites then record a retryable failure with a copyable link, and OTP
codes come back in the response as `devCode` (and to the server log). `INVITE_LINK_BASE` defaults
to `reliancegreentech://invite`, so a token opens straight into Expo Go:

```bash
npx uri-scheme open "reliancegreentech://invite/<token>" --android
```

⚠ **That default cannot ship.** WhatsApp only auto-links `http(s)`, so a custom-scheme link
arrives as dead text. Production needs an https universal/app link with a web fallback. Startup
refuses to boot in production with `OTP_DEV_ECHO` on or `OTP_PEPPER` empty.

**`INVITE_LINK_BASE` always points at the deployed Azure app — never at a tunnel.** Not
`trycloudflare.com`, not ngrok, not a LAN IP. A quick-tunnel hostname dies with the process that
created it and is different every restart, so every invite sent before the last restart becomes a
dead "site can't be reached" link in somebody's WhatsApp. No tunnel is needed anyway: the landing
page never looks the token up, so a token minted by the LOCAL API opens fine through the Azure
page and the app resolves it against the shared Azure database.

```
INVITE_LINK_BASE=https://installflowapi-bqh6d9e2hhaedye0.centralindia-01.azurewebsites.net/invite
```

**That `installflowapi` hostname keeps its pre-rebrand name on purpose — do not "fix" it.** The
product is Reliance GreenTech everywhere a person can see it, but an Azure App Service cannot be
renamed, and this host is baked into `scripts/publish.py`, both clients' `.env`, and the Android
App Link intent filter compiled into installed builds. Renaming it means a new resource, a
redeploy, a fresh mobile build, and every invite link already sitting in somebody's WhatsApp goes
dead. The name is infrastructure, not branding; nobody outside the team reads it.

## Commit rhythm

**One commit per completed screen.** Run `npm run lint && npm run typecheck` first.
Conventional Commits, e.g. `feat(jobs): masked job offer and accept sheet`.

## Domain facts that are easy to get wrong

- **Only a VENDOR raises a ticket.** Vendors are outside parties with their own login and their own
  restricted portal; company staff — admin, national head, regional head, area manager — see and
  work tickets but can no longer create them. A vendor sees every ticket its people raised; a
  vendor's sub-user sees only the ones they raised themselves.
- A vendor's **login is created with the vendor**, on the Vendors screen, by a National Head or
  above. It is required: only a vendor raises tickets, so a vendor without an account is a brand
  nobody could ever raise a ticket against.
- A vendor's **`intake_channels` decide which entry screens its portal offers.** Manual today;
  Excel appears when the bulk importer exists; API is somebody else's application calling ours.
- The **customer confirms the slot before any technician sees the job**. A technician accepts a
  fixed time — they never propose one.
- Assignment is **first-accept-wins**. Losing the race is a normal outcome, not an error.
- **Customer name, phone and address stay masked until the technician accepts.**
- Cancelling costs money, banded by lateness: **₹80** (>8h) · **₹150** (4–8h) · **₹250** (<4h,
  which also escalates to the Area Service Manager).
- Bandwidth is a **simple jobs-per-day cap**, not weighted by job type — and it is **optional**.
  `daily_job_cap` is nullable and **NULL means no limit**, which is what every new technician has:
  neither the console's Add screen nor the joining flow asks for one, because a number invented
  before anybody has worked a day is a number nobody has a basis for. The technician sets their own
  in the app (Profile → Availability & bandwidth) and a manager can change it afterwards. There is
  no upper bound; the floor is 1, because a cap of 0 means "never offer me work", which is what
  going offline says. It is counted by **SLOT date in IST** — the day the work happens, not the day
  it was accepted — and `Closed` jobs still count, because the cap means "how many will I do that
  day", not "how many are still open". Only `Cancelled` frees the slot back.
- **A ticket's history lives in `ticket_events`, not in its `status` column.** Both of the two
  facts above need a moment, not a state: the cancellation band is measured from the slot, and a
  closure has to be answerable for later. Overwriting `status` keeps neither. Write the event in the
  same transaction as the change it describes — a trail that can disagree with the ticket is worse
  than none.
- **`expected_date` and the confirmed slot are allowed to differ**, and the gap between them is
  worth reporting on. Expected date is what ops were asked for; the slot is what the customer
  chose from the windows the service level permits. They are two facts, not one fact stored twice.
- The **expected serial is mandatory** on every ticket and every service type. It was optional
  while ops typed tickets and often did not have it; the vendor holds the invoice, so it is
  knowable at intake — and AI verification always has something to compare the photographed serial
  against. Not unique: a service call on a unit installed earlier repeats it.
- Proof is **four** artifacts: barcode, serial, product photos, geo-tagged live photos.
  Gallery uploads are never accepted.
- AI verification has **three** outcomes: match → closure · mismatch → ASM review ·
  unreadable → retake on-site before leaving.
- Auth is **OTP only** for technicians — the phone IS the credential, so there is no password
  and no "forgot password". Console users still sign in with email + password; `users.email` and
  `users.password_hash` are nullable precisely because a technician has neither.
- There are **two onboarding modes**, and a technician record records which:
  `onboarding_mode` (invite | direct) is how the record came to exist, `registered_by`
  (self | manager) is who actually filled it in. They are not the same question — a manager can
  invite someone who then registers themselves. `created_by` is the appointing manager in BOTH
  cases; do not overload it to mean "who typed it".
- **Direct**: a manager fills in everything; the technician just signs in and lands on Home.
- **Invite**: a manager supplies only a phone number; the technician self-registers their name,
  photo, subcategories and coverage from the deep link. Nothing is written until they prove the
  phone by OTP, and then it all commits in one transaction.
- **Geography is a loaded master, not free text.** `regions → states → districts → pincodes`,
  global (no `company_id` — India is the same for every company), imported from a spreadsheet by
  a superadmin on **Super Admin → Geography**. 36 states, 754 districts, 19,496 pincodes.
  A pincode↔district link is many-to-many because 1,258 real pincodes span up to four districts.
- **A Regional Head covers regions; an Area Manager covers STATES.** Nobody assigns their own
  territory — a senior does it in Users & roles. The RH picks regions and the states under them
  are shown read-only (he is responsible for all of them). The AM picks states, and his region is
  **derived** from them, never sent by the client.
- An Area Manager **covers every pincode inside his states** — that coverage is resolved from the
  master at query time and never stored or materialised. One state can hold nearly 2,000 codes,
  so anything asking "is this pincode his?" does it as a subquery (`pincodes_in_states`).
- An **Area Manager may only assign pincodes inside his own states** — enforced on create, on
  update, and on the coverage a technician they invited picks for themselves. The refusal names
  the offending pincodes.
- **Technicians share pincodes; area managers do not share states.** `membership_states` is unique
  on `(company_id, state_id)`; `technician_pincodes` is deliberately not unique. Two technicians on
  the same street is the normal case, which is why they are separate tables.
- A technician certifies on a **subcategory** (Television), not a category (Electric). The
  product master is category → subcategory → model, company-scoped, with an icon on the first two
  levels and **up to five photo URLs** on the model — ordered, the first being the thumbnail every
  list draws.
- **Images are uploaded, never embedded.** The file goes to blob storage via `POST /uploads`; the
  record stores its URL. The API refuses a `data:` URL and a local `file://` path in every slice
  that takes one — see `api/app/core/images.py`. A signed-in principal is required, which is why a
  self-registering technician's photo is sent right AFTER their account exists, not with it.
- **One upload flow in both clients:** tapping or clicking an image control opens the file
  picker straight away → the crop screen/dialog opens on the chosen photo → saving uploads it.
  Never an extra "choose a photo" step in between. On the web every control also accepts a drop,
  and a gallery field takes several files at once, cropped one after another. Details and the
  shared pieces: `adminWeb/AGENTS.md` → "Image upload".
