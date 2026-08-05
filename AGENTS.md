# Videocon Technician Field App

React Native app for technicians doing **installation & demo** jobs — accept a job with a
customer-confirmed slot, travel, install, capture AI-verified photo proof, close the ticket.

> **Expo HAS CHANGED.** Read the exact versioned docs at
> https://docs.expo.dev/versions/v54.0.0/ before writing any code.

Source of truth for behaviour and design lives in [RequirementDocs/](RequirementDocs/):

- `Installation_Requirement_Document.docx` — the business flow
- `Technician Field App.html` — a clickable prototype with all **18 screens**. It is a design
  artifact with no reusable code, but its copy, layout and colours are **approved** — match it.

For the per-screen spec, token tables and component patterns, load the **`videocon-tech-app`**
skill in `.claude/skills/`.

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
RequirementDocs/        business flow + the approved prototype
mobileapp/              the Expo app — ALL app work happens in here
```

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
