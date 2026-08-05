# Videocon Technician Field App

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

For the per-screen spec, token tables and component patterns, load the **`videocon-tech-app`**
skill in `mobileapp/.claude/skills/`.

## Phase: UI only

**Do not build APIs, an axios client, interceptors, or a response envelope.** Screens render
from typed mock data in `src/mocks/`. The Python backend and binding are a separate, later phase.

Each screen's data still comes from a TanStack Query hook whose `queryFn` returns mock data —
so binding later is a one-line change per hook, and we get loading/empty/error states today.

## Stack

Expo SDK 54 · React Native 0.81 · React 19.1 · TypeScript (strict) · Expo Router ·
NativeWind 4 (Tailwind 3) · TanStack Query · Zustand · React Hook Form + Zod ·
react-native-svg · expo-camera · Roboto via `@expo-google-fonts/roboto`

Everything currently installed runs in **Expo Go**. Do not add third-party native modules
(`react-native-mmkv`, `react-native-keyboard-controller`, Sentry) without flagging it — they
break Expo Go and force a dev-client build.

## Hard rules

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
adminWeb/               the InstallFlow ops console (React + Vite) — see adminWeb/AGENTS.md
api/                    the Python backend — later phase, currently empty
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
  videocon-tech-app           the 18-screen spec, tokens, penalty bands, proof state machine
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
api/.claude/skills/         BACKEND ONLY — create when the Python phase starts
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

## Commit rhythm

**One commit per completed screen.** Run `npm run lint && npm run typecheck` first.
Conventional Commits, e.g. `feat(jobs): masked job offer and accept sheet`.

## Domain facts that are easy to get wrong

- The **customer confirms the slot before any technician sees the job**. A technician accepts a
  fixed time — they never propose one.
- Assignment is **first-accept-wins**. Losing the race is a normal outcome, not an error.
- **Customer name, phone and address stay masked until the technician accepts.**
- Cancelling costs money, banded by lateness: **₹80** (>8h) · **₹150** (4–8h) · **₹250** (<4h,
  which also escalates to the Area Service Manager).
- Bandwidth is a **simple jobs-per-day cap** (1–12), not weighted by job type.
- Proof is **four** artifacts: barcode, serial, product photos, geo-tagged live photos.
  Gallery uploads are never accepted.
- AI verification has **three** outcomes: match → closure · mismatch → ASM review ·
  unreadable → retake on-site before leaving.
- Auth is **OTP only**. There is no password, so there is no "forgot password".
- Registration arrives via an **invite deep link** with identity fields locked.
