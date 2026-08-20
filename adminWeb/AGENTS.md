# InstallFlow · Ops Console (adminWeb)

The **web admin portal** for the Videocon installation & demo service — the ops/management half
of the system whose technician half lives in `mobileapp/`. Ticket intake → customer slot
confirmation → technician allocation → escalation & bonus → AI proof review → audited closure.

Roles: **NH** (National Head) · **RSH** (Regional Service Head) · **ASM** (Area Service Manager)
· **Ops Staff**. The customer and the technician never log in here.

## Sources of truth

| Source | What it settles |
|---|---|
| [RequirementDocs/Installation_Requirement_Document.docx](../RequirementDocs/) | the business flow (11 sections) |
| [webdesign/Admin Portal.dc.html](webdesign/) | **approved** copy, layout, colours — all 20 screens |
| [webdesign/support.js](webdesign/support.js) | the DC runtime that makes the prototype runnable |

**Never invent copy.** Every label, heading, empty-state line and button string is in the
prototype. If a string isn't there, ask — do not write filler.

### Reading the prototype correctly

`support.js` is a ~1,900-line runtime that boots the `.dc.html` into React 18 (React + ReactDOM
UMD from unpkg, so it needs internet). It is **plumbing, not design** — none of it ports over.
Three rules it establishes:

1. **`hint-placeholder-val` / `hint-placeholder-count` / `hint-size` are authoring hints, not
   defaults.** They only render while the design tool is streaming. Real defaults live in the
   `state` object of the `data-dc-script` class (`loggedIn:false`, `screen:'dashboard'`,
   `role:'ASM'`). Reading `hint-placeholder-val="{{ true }}"` as "this shows by default" is wrong.
2. **`style-hover="…"` is real approved interaction design.** Any `style-<pseudo>` attribute
   compiles to a generated `!important` stylesheet rule. Port those hovers.
3. **Template expressions are near-powerless** — identifier paths, dot/bracket access and
   top-level `==`/`!=` only. That is *why* the prototype passes pre-computed style strings from
   `renderVals()`. Do not copy that pattern; in React it becomes props and Tailwind classes.
4. Canvas colours in `support.js` (`#f0eee6`, `#2e2c26`) belong to the design tool's canvas.
   **They are not part of the InstallFlow palette.**

To run the prototype: serve `webdesign/` over HTTP and open `Admin Portal.dc.html`. Login is
prefilled (`ravi.sharma@installflow.in` / `demopass`); any 6 digits pass OTP.

## Phase: partly bound

`services/http.ts` is the real transport. Live: auth, companies, **users & roles**, territory,
the **product master** (`/masters/*`) and **technicians** (`/technicians/*`, `/onboarding/*`).

Still mock, in `src/services/mocks/` behind TanStack Query hooks: tickets, escalations, the
ledger, AI review, dashboard, vendors, imports and notifications — so binding each stays a
one-line change and loading / empty / error states are already there.

Two seams to know about:
- `services/client.ts` is the MOCK transport, `services/http.ts` the real one. Both unwrap the
  same envelope, so a slice moves between them without touching its hooks.
- `listEligibleTechnicians` is deliberately still mocked even though technicians are live: it
  answers "who has bandwidth left for this ticket", which needs open assignments and therefore
  the jobs slice. The old flat technician shape survives as `EligibleTechnician` for it alone.
  Its live sibling, `listCandidateTechnicians`, answers the part that IS knowable — active,
  certified for the ticket's subcategory, covering its pincode — because `GET /technicians`
  already filters on both. It shows the daily CAP and says nothing about today's load.
- **Assignment has no endpoint.** `assignTechnician` in `services/tickets.ts` rejects with a 501
  the way `forceCloseTicket` does. `tickets.technician_id` and the `Assigned` status exist;
  `ticket_events.kind` has no `assigned` yet, so the real thing needs a migration.

**Do not fake a number that has a real source.** A null rating renders `—`, not `0`; the
technician job-history table renders empty rather than inventing rows.

---

## Install the skills

Skills are **scoped to the folder they apply to** (see the scoping map in the root `AGENTS.md`).
Four web-only skills live here in `adminWeb/.claude/skills/`, pinned in `adminWeb/skills-lock.json`;
four cross-platform ones live at the repo root and apply everywhere.

| Scope | Skills |
|---|---|
| `adminWeb/.claude/skills/` — **web only** | `shadcn` · `tailwind-design-system` · `webapp-testing` · `frontend-design` |
| root `.claude/skills/` — global | `grill-me` · `typescript-advanced-types` · `vercel-composition-patterns` · `vercel-react-best-practices` |

**Never load this folder's four for `mobileapp/`.** `shadcn` is Radix + react-dom and renders
nothing in React Native; `tailwind-design-system` teaches Tailwind v4 `@theme`/`@apply` while
NativeWind 4 runs Tailwind **3**; `webapp-testing` drives Playwright against an HTTP server;
and the mobile design is already approved and locked to its prototype.

Restore this scope on a fresh clone — **run it from `adminWeb/`**, not the repo root:

```bash
cd adminWeb
npx skills experimental_install
```

To reinstall from scratch. The CLI installs relative to the working directory, so the `cd`
matters; `-a claude-code` is required (plain `claude` is rejected) and `-y` skips the prompt:

```bash
cd adminWeb
npx skills add https://github.com/shadcn/ui         --skill shadcn                 -a claude-code -y
npx skills add https://github.com/wshobson/agents   --skill tailwind-design-system -a claude-code -y
npx skills add https://github.com/anthropics/skills --skill webapp-testing         -a claude-code -y
npx skills add https://github.com/anthropics/skills --skill frontend-design        -a claude-code -y
```

The four global ones install the same way from the repo root:

```bash
npx skills add https://github.com/mattpocock/skills        --skill grill-me                    -a claude-code -y
npx skills add https://github.com/wshobson/agents          --skill typescript-advanced-types   -a claude-code -y
npx skills add https://github.com/vercel-labs/agent-skills --skill vercel-composition-patterns -a claude-code -y
npx skills add https://github.com/vercel-labs/agent-skills --skill vercel-react-best-practices -a claude-code -y
```

`grill-me` sets `disable-model-invocation: true` — an agent can't load it on its own judgment.
**You** trigger it with `/grilling`. The rest load automatically when relevant.

To browse a repo before adding: `npx skills add <repo-url> --list`.

### Skills already available in this workspace — use them, don't reinstall

| Skill | Use it for |
|---|---|
| `secure-storage-design-system` | closest match to this build: role-gated admin app, TanStack Query + Zustand + RHF + Zod, RBAC as server-side guards, pagination contract, skeleton-per-screen loading |
| `dataviz` | **load before writing any chart** — the Dashboard's SLA bar, funnel, KPI tiles and the Ledger charts |
| `videocon-tech-app` | the technician side. Load it when a rule must match across both apps (penalties, proof, statuses) |
| `polished-react-site` | animation/motion patterns only. Its marketing-site conventions do **not** apply to a console |

### When to reach for which

- `frontend-design` + `tailwind-design-system` → before building `theme.css` or any new screen.
- `shadcn` → before adding any shadcn component; never hand-roll a primitive it ships.
- `vercel-react-best-practices` / `vercel-composition-patterns` → before splitting a screen into
  child components, and on any "why is this re-rendering" question.
- `typescript-advanced-types` → the discriminated unions for ticket status and AI outcome.
- `webapp-testing` → every list screen and every destructive flow (force-close, assign, bonus).
- `grill-me` → before committing a slice, to pressure-test the edge cases.

---

## Stack

React 19 · TypeScript (strict) · Vite · React Router · Tailwind CSS v4 · shadcn/ui ·
TanStack Query · Zustand · React Hook Form + Zod · Framer Motion · lucide-react

Tailwind **v4** — theme tokens are declared in CSS with `@theme`, which is exactly what
"centralize everything in `theme.css` and use CSS variables" requires. No `tailwind.config.js`
colour table.

---

## Project structure

```
adminWeb/
  public/images/placeholders/
  src/
    components/
      dashboard/          KpiRow · SlaBar · FunnelStrip · AttentionCards · RecentTickets
      tickets/            TicketTable · TicketFilters · StatusBadge · SlaBadge · TimelineEvent
                          FactGrid · ProofGrid · ManualEntryForm
      vendor/             VendorShell · PortalNav · portalNav.ts · AddVendorUserDialog
                          — the vendor PORTAL, a third shell. See below.
      escalations/        EscalationCard · BonusPicker · EligibleTechTable
      ai-review/          AiQueueTable · ConfidenceMeter · SerialCompare · ProofLightbox
      technicians/        TechTable · BandwidthBar · TechProfileHeader · JobHistoryTable
      masters/            VendorTable · TerritoryTree · CategoryCard · UserTable
      settings/           SlaRuleList · PenaltyBandTable · ThresholdSlider
      shared/             AppShell · Sidebar · Topbar · RoleTabs · PageMeta · DataTable
                          EmptyState · ErrorState · TableSkeleton · ConfirmDialog · Money
                          FilterPills · PaginationControls · ThemeToggle
      ui/                 shadcn/ui primitives (generated — do not hand-edit)
    pages/
      dashboard/DashboardPage.tsx
      tickets/            TicketListPage · TicketDetailPage · ManualEntryPage
                          BulkUploadPage · ValidationResultPage · ForceClosePage
      escalations/        EscalationQueuePage · BonusSetupPage · ManualAssignPage
      ai-review/          AiQueuePage · AiReviewDetailPage
      technicians/        TechnicianListPage · TechnicianProfilePage
      ledger/LedgerPage.tsx
      masters/            VendorsPage · TerritoryPage · CategoriesPage
      settings/           RulesConfigPage · UsersRolesPage
      auth/LoginPage.tsx
    hooks/                useTickets · useEscalations · useAiQueue · useTechnicians · useRules …
    services/
      mocks/              seeded mock data, one file per domain
      tickets.ts …        the seam the real API replaces later
    store/                Zustand — client state only
    contexts/             ThemeContext
    types/                ticket.ts · technician.ts · escalation.ts · ai.ts · rules.ts · user.ts
    utils/                money.ts · date.ts · sla.ts · cn.ts
    styles/theme.css      SINGLE SOURCE for every token
    index.css             imports theme.css + Tailwind
```

**A page component composes; it does not render.** `TicketListPage.tsx` wires the hook, the
loading/empty/error branches and the child components — nothing else. All markup lives in
`components/<slice>/`.

---

## Theme

Everything — brand ramp, semantic roles, typography, spacing, radii, shadows, gradients — is
declared once in `src/styles/theme.css`. **No hex value outside that file.** No inline `style=`
in a component. No component-level CSS file.

### Brand ramp

500 is the primary. Every value below is lifted from the approved prototype, not invented:

```css
--brand-color-100: #eceeff;  /* tint — 'New' status chip, intake icon */
--brand-color-200: #c4c6ee;  /* on-brand body text */
--brand-color-300: #a9ace0;  /* on-brand muted text */
--brand-color-400: #3a3f9e;  /* hover / secondary brand */
--brand-color-500: #2c2f74;  /* PRIMARY — sidebar, buttons, active nav */
--brand-color-600: #22245c;  /* darkest — gradient stop, pressed */
```

`#4a4fb0` and `#2f5bbf` also appear in the prototype but are **status** colours, not brand steps
— they live in the semantic block below.

### Semantic tokens

```css
--surface / --surface-2 #f7f8fb / --surface-3 #f1f3f7 / --bg #eef0f4
--border #e2e5ec / --border-2 #eceef3
--ink #171a21 / --ink-2 #565c68 / --ink-3 #8b909d
--accent #e5562b            /* badges & alert dots ONLY — never a button fill */
--ok #1a8a4d + --ok-bg      --warn #b9770a + --warn-bg
--danger #cf3446 + --danger-bg   --info #215fa6 + --info-bg
--radius-sm 6px / --radius 8px / --radius-lg 12px
--shadow / --shadow-lg
--font-sans 'IBM Plex Sans' / --font-mono 'IBM Plex Mono'
```

Ticket-status and SLA-state colours get their **own** named tokens
(`--status-ai-review`, `--sla-breached`, …) mapped from these. Screens reference the role, never
the ramp position — that indirection is what makes a re-skin one file.

### Layout tokens

sidebar `236px` · topbar `60px` · page padding `22px` (`16px` on mobile). Custom Tailwind
breakpoints to match the prototype, **not** Tailwind's defaults:

```
sm 560px   md 880px (sidebar → drawer)   lg 1000px (search appears)   xl 1360px
```

**There is no content max-width.** `AppShell`'s `<main>` is fluid and every screen inherits it —
a console is a work surface, so a wide monitor should buy more table, not more margin. Never add
`max-w-*` to a page root or a full-width card. (The prototype caps content at 1360px; that is the
one place we deliberately depart from it.) Constrain reading width only where a long paragraph
would otherwise stretch — a form column, a justification note — never a table or a card grid.

### Dark mode

Implement the toggle (`ThemeToggle` + `ThemeContext`, `class` strategy, persisted, honouring
`prefers-color-scheme` on first load). Every dark value is a `--*` override inside
`[data-theme="dark"]` in `theme.css` and nowhere else.

⚠️ **The approved prototype is light-only.** The dark palette is therefore *derived*, not
approved — flag it for sign-off before it ships. (This differs from `mobileapp/`, which bans dark
mode outright because technicians work outdoors; a desk console has no such constraint.)

---

## Hard rules

### 0a. Three surfaces, and a vendor must never reach the ops one.

`routes.tsx` has three top-level branches, each with its own shell: `/companies` (superadmin),
`/portal/*` (vendor), and everything else (staff). `landingPath()` in `store/session.ts` is the ONE
place they are ranked; the two guards, the login redirect and the catch-all all read it, because
five call sites deciding independently is how they stop agreeing.

**The portal is a top-level branch, not routes under `AppShell`, and that is a security decision.**
`useFeatureAccess().has(undefined)` returns **true**, so eight ops paths are ungated — `/`, the
three escalation routes, the two AI-review ones, `/notifications` and `/account`. Nested, each
would be a per-screen decision to get right; bounced in `RequireAuth` before `AppShell` mounts, a
vendor never reaches the guard that would have to decide. Escalations, AI Review and Notifications
are still MOCKED, so the alternative is an outside party reading fabricated internal data.

`RequirePortalFeature` therefore runs the **opposite polarity** to `RequireFeature`: an unrecognised
path is DENIED, and the two genuinely open paths are an explicit allow-list in `portalNav.ts`.
`PortalNavItem.feature` is required rather than optional for the same reason.

**Deleting a route does not close a path.** `/tickets/new` still matched `tickets/:id` with
`id="new"` and rendered the detail screen 422-ing on a ticket called "new". Dead paths get an
explicit redirect.

### 0. Multi-tenant. The active company is the session's, and never the client's to choose.

Every list, form and detail page shows ONE company's data — whichever the user has switched to.
The console never sends a company id it was not given, never caches rows across a company switch,
and never assumes an id from one company resolves in another.

Concretely: after `CompanySwitcher` changes company, invalidate the queries rather than filtering
client-side; treat a 404 on a detail route as "not yours", which is exactly what the server means
by it; and never put a company id in a URL as a way of selecting one.

The server enforces all of this — see the tenancy rules in `api/AGENTS.md` — so a bug here is a
confusing screen, not a leak. That is not a reason to be careless with it.


1. **No hex outside `theme.css`.** Use a Tailwind token class or `var(--…)`.
2. **No inline styles, no per-component CSS.** The prototype is 100% inline styles — that is an
   artifact of the DC runtime's powerless template language, not a design decision. Translate it.
3. **Semantic roles, not ramp positions.** `text-status-escalated`, not `text-[#cf3446]`.
4. **No server state in Zustand.** Tickets, technicians, escalations, ledger, rules → TanStack
   Query. Zustand holds session/role, sidebar open, theme, and in-flight multi-step form drafts.
5. **Every list screen ships loading, empty and error states.** Skeleton matching the real table
   shape — never a spinner. Not optional.
6. **Tailwind classes are static strings.** An interpolated `bg-${role}-500` never gets generated.
7. **Money is always formatted through `utils/money.ts`** (`en-IN`, `₹`, `−₹` for debits). Never
   inline `toLocaleString`.
8. **RBAC is enforced server-side.** The prototype's NH/RSH/ASM tabs only swap a label — real
   scoping is undesigned. Hiding UI is presentation, never authorization.
9. **Every API error surfaces in the toaster — everywhere, no exceptions.** Never hand-roll an
   inline red box for a failed request, and never let a rejection die in a silent `catch`. See
   *Error reporting* below.
10. **A single-option dropdown fills itself.** Any select whose choices are computed from data
    (role, region, vendor, category, model…) must auto-pick the sole option when exactly one is
    available — never make the user open a one-item menu. Use `useAutoSelectSingle` (in
    `src/hooks/`); it only writes while the field is empty, so it never overrides a real choice or
    a value loaded into an edit form, and takes an `enabled` flag to stay quiet while the list is
    loading or the control is disabled. Static, fixed-length selects (status filters, page size,
    SLA type) are exempt — they can never collapse to one.

---

## Page-wise architecture

| Route | Page | Notes |
|---|---|---|
| `/login` | `LoginPage` | two steps: email + password → 6-digit OTP. Admin **has** a password (unlike the technician app, which is OTP-only) |
| `/` | `DashboardPage` | 4 KPI tiles · SLA stacked bar · 3-stat funnel · "Needs your attention" (4 cards, each deep-links) · recent tickets |
| `/tickets` | `TicketListPage` | status pills, search, **default sort = SLA urgency** (breach → warn → ok → done) |
| `/tickets/:id` | `TicketDetailPage` | facts grid · timeline & audit trail · customer · technician · proof-of-completion grid |
| `/tickets/new` | `ManualEntryPage` | vendor/category/model · request type · customer · SLA · submit fires the slot request |
| `/tickets/import` | `BulkUploadPage` | dropzone, 8 required columns, max 5,000 rows |
| `/tickets/import/:batchId` | `ValidationResultPage` | per-row pass/reject **with reason**; rejects never block the file |
| `/tickets/:id/force-close` | `ForceClosePage` | reason + notes + **mandatory attachments** |
| `/tickets/:id/assign` | `AssignTechnicianPage` | real ticket + a LIVE shortlist (`subcategoryId` + `pincode`, server-filtered). Assignment itself is a 501 until the jobs slice lands |
| `/escalations` | `EscalationQueuePage` | unassigned within 4h of slot; time-to-slot + bonus pool |
| `/escalations/:id/bonus` | `BonusSetupPage` | ₹200/400/600/800 from the pool; slot stays locked |
| `/escalations/:id/assign` | `ManualAssignPage` | the MOCK queue's copy — its `:id` is a ticket CODE, not a UUID. The ticket screens use `/tickets/:id/assign`; the two converge when escalations bind |
| `/ai-review` | `AiQueuePage` | below-threshold or unreadable |
| `/ai-review/:id` | `AiReviewDetailPage` | 4 proof images · expected vs detected serial · Approve / Reject·retake |
| `/technicians` | `TechnicianListPage` | |
| `/technicians/:id` | `TechnicianProfilePage` | bandwidth, cancels, net ledger, job history |
| `/ledger` | `LedgerPage` | pool balance, penalties collected, bonuses paid, transactions |
| `/vendors` · `/territory` · `/categories` | masters | territory is Region → RSH → ASM → pincodes |
| `/settings/rules` · `/settings/users` | settings | |

**Domain types are discriminated unions.** `TicketStatus` = `New | Slot Pending | Assigned |
In Progress | AI Review | Escalated | Closed | Force-Closed | Cancelled` (9).
`SlaState` = `ok | warn | breach | done`. `AiOutcome` = `match | mismatch | unreadable` (3).

### Reusable component strategy

Three tiers. Promote downward only when a third consumer appears — two usages is a coincidence.

- **`ui/`** — shadcn primitives, generated, never hand-edited.
- **`shared/`** — cross-slice: `AppShell`, `DataTable`, `EmptyState`, `ErrorState`,
  `TableSkeleton`, `ConfirmDialog`, `PageMeta`, `Money`, `StatusBadge`, `FilterPills`.
- **`<slice>/`** — everything else, private to its feature.

Nine of the twenty screens are a filtered table over a domain list. Build **one** `DataTable`
(column defs, sort, empty/loading slots) and configure it; do not write nine tables.

---

## State management

| Kind | Home | Examples |
|---|---|---|
| Server state | TanStack Query | tickets, escalations, AI queue, technicians, ledger, rules, users |
| Client state | Zustand | session + active role, sidebar open, theme, multi-step form drafts |
| Form state | RHF + Zod | manual entry, bulk upload, bonus, force-close, rules config |
| URL state | React Router | filters, status pill, page, selected id — filters belong in the query string so a view is shareable |

Query keys are tuples: `['tickets', filters]`, `['ticket', id]`, `['escalations']`. Invalidate by
prefix after every mutation. `staleTime` 30s for lists; escalations and the AI queue are
time-sensitive — 10s with `refetchOnWindowFocus`.

## API service architecture

`services/<domain>.ts` exports plain async functions returning typed domain objects. Today they
resolve from `services/mocks/` behind a small artificial delay so loading states are real. Hooks
in `hooks/` wrap them in `useQuery` / `useMutation` and are **the only thing components import**.

When the Python backend lands, only the bodies in `services/` change. No component and no hook
signature moves. Zod schemas in `types/` validate at that boundary, so a backend field rename
fails loudly at parse time instead of rendering `undefined`.

## Auth & token refresh

Access token **30 min**, refresh token **7 days**, and the backend **rotates**: every call to
`POST /auth/refresh` revokes the token presented and issues a new pair. Both are stored in the
session store and persisted (`localStorage` — an httpOnly cookie would be safer, but the backend
returns both in the response body, so that is an API change, not a client one).

Renewal lives in `services/http.ts` and **nothing above it knows it exists**. A 401 triggers one
refresh and replays the original request; the screen sees only the eventual result.

- **Single-flight.** All concurrent 401s share one refresh promise. Six queries failing together
  must not fire six refreshes — rotation would revoke five of them mid-flight and kill the session.
- **One replay.** If the second attempt also 401s, the token was not the problem.
- **`NO_REFRESH`** excludes `/auth/refresh` (a failed refresh ends the session), `/auth/login`
  (its 401 means *wrong password* — replaying resends bad credentials) and `/auth/logout`.
- **Only 401/403 from the refresh endpoint ends the session** — `signOut()` plus a hard
  `location.replace("/login")`, which drops the query cache with the rest of the page. A 500 or a
  network failure proves nothing about the token, so the session survives.
- **`logout` must be given the refresh token.** Called without one the backend revokes *every*
  unrevoked token the user holds, signing them out of every other browser. Verified against the
  live API, both branches.
- Bump the persist `version` in `store/session.ts` whenever the token shape changes — a
  half-migrated session that holds an access token with no way to renew it is worse than a
  sign-in prompt.

## Error reporting

**One rule: every API error shows up in the toaster.** A failed request is never silent, and it
is never reported in two places at once.

It is wired **once**, in the `QueryCache` and `MutationCache` handlers in `src/App.tsx`, which
call `toastApiError` from `src/lib/apiError.ts`. That means a new hook or screen gets error
reporting for free and cannot forget it — there is nothing to remember at the call site.

| Concern | Where |
|---|---|
| The failure message itself | the toaster, always — global handler |
| Which action failed | `meta: { errorTitle: "Couldn't add the user" }` on the query/mutation |
| A list/detail that has no data to render | `ErrorState` in place, with **Retry** |
| Field-level validation | RHF + Zod on the field, `aria-invalid` + `role="alert"` |

- `describeError` normalises anything thrown into `{ title, description }`. `title` is the call
  site's `meta.errorTitle`, falling back to a short status label (`Network error`,
  `Check the details`, `Not allowed`, `Server error`…); `description` is the envelope's `message`
  plus its `errors[]`, de-duplicated. Toasts are `type: "error"`, `priority: "high"` and live
  8s — long enough to read while re-typing a form.
- Repeats inside a 4s window collapse to one toast, so a dead backend failing twelve queries at
  once is **one** message, not twelve.
- The toast viewport sits above the dialog layer, so a mutation fired inside a dialog can report
  its failure over the open dialog.
- `meta: { suppressErrorToast: true }` is the only opt-out, and only when the screen genuinely
  owns the message. Both meta keys are typed in `src/types/query-meta.d.ts`, so a typo is a
  compile error rather than a silently lost title.
- `ErrorState` is **not** a duplicate of the toast: it fills the region a table or a detail would
  have occupied and offers Retry. Keep it for query failures (hard rule 5). Do not add one for a
  mutation — the toaster has that.
- Anything that awaits a mutation outside a hook (a form's `onSubmit`) may swallow the rejection,
  because the global handler has already reported it. `try { … } catch { /* toasted */ }` — never
  `setError("root", …)`.

---

## Responsive strategy

Mobile-first, tokens above. `< 880px`: sidebar becomes an overlay drawer with a scrim, page
padding drops to 16px, multi-column grids collapse to one. `< 560px`: every grid is single
column. Tables get a horizontal scroll container with a sticky first column — never a squeezed
table, never a card-list rewrite that loses columns. Content is **fluid at every width** — no max
cap — so an ultra-wide monitor shows more of the table instead of dead margin.

## SEO strategy

This is an **internal console behind authentication**. Applying the public-marketing checklist
verbatim would be wrong, so:

| Requirement | Here |
|---|---|
| Unique page titles | ✅ via `PageMeta` — `InstallFlow · Escalation queue`. Drives tab + browser history |
| Meta description | ✅ minimal, one per route |
| `robots` | ✅ **`noindex, nofollow`** on every route |
| Canonical URLs | ✅ trivial, one canonical per route |
| Open Graph / Twitter cards | ❌ nothing here is shareable to a social crawler |
| Structured data | ❌ no public entity to mark up |
| Sitemap | ❌ no crawlable surface — but routes stay declarative and centralized, so a sitemap is generatable if a public page ever appears |

If a public marketing or vendor-signup page is ever added to this app, the full checklist applies
to that route only.

## Accessibility strategy

Semantic HTML5 (`<nav>` `<main>` `<aside>` `<table>`), exactly **one `<h1>` per page** (the
topbar page title). Real `<table>`/`<th scope>` for data — no div grids. ARIA labels on every
icon-only button (the sidebar toggle, bell, row actions). Full keyboard navigation with a visible
`:focus-visible` ring using a dedicated `--ring` token; the drawer and every dialog trap focus and
restore it on close. Forms use `<label for>`, `aria-describedby` for hints, `aria-invalid` +
`role="alert"` for Zod errors, and never colour alone to signal failure — the validation table
pairs its red with the word "Rejected" and a reason. Status and SLA badges carry text, not just a
tint. Alt text describes the proof image's purpose ("Barcode capture submitted by Sunil Pawar"),
not "image". Contrast is verified against WCAG AA in **both** themes — `--ink-3 #8b909d` on
`--surface-2` is borderline; it is for de-emphasised metadata only, never body copy. All Framer
Motion animation respects `prefers-reduced-motion`.

## Performance plan

Route-based code splitting via `React.lazy` + `Suspense`, with the skeleton for that screen as
the fallback — not a blank page. Heavy leaf components (proof lightbox, charts, the territory
tree) lazy-load too. Images: `loading="lazy"`, `decoding="async"`, explicit `width`/`height` to
kill CLS, `.webp`. Long tables virtualize past ~200 rows. Framer Motion is imported per-component,
never namespace-wide. Keep the vendor chunk lean and tree-shakeable; **audit before adding any
dependency** — target Lighthouse 95+.

**Three.js is not used.** No screen in the approved design has a 3D surface, and shipping a WebGL
runtime into an internal ops console works directly against the 95+ target. If a login-page
visual is wanted later, it must be lazy-loaded, behind `prefers-reduced-motion`, and approved
first.

## Image upload — one flow, everywhere

Every control that takes an image behaves identically. Do not invent a second
shape for it, and do not hand-roll a file input:

1. **Click opens the file explorer.** The camera badge, the Add tile, the upload
   button — one click, and the OS picker is up. There is **no intermediate
   "choose a photo" dialog**: the click already said "choose a photo", so asking
   again is a step that exists only to be dismissed.
2. **The crop dialog opens on the chosen file**, already showing it, with Save
   and Cancel. Nothing else in between.
3. **Save uploads it** to `POST /uploads` and hands the caller back a URL.

**Everything is also a drop target.** Dragging files onto the avatar disc, the
photo strip or the dropzone does exactly what choosing them does — same
validation, same crop dialog, same upload. The target highlights with
`ring-2 ring-brand-500` while files hover it, and it is the whole area a user
would aim at, never a 64px tile.

**Where the field holds a gallery, the picker is `multiple`.** Several files
picked or dropped at once queue up and are cropped one at a time in place —
"Photo 2 of 3" — because each photo needs its own framing. `max` is the room
actually left, so a pick that overflows is refused with a reason rather than
silently truncated.

The two pieces are [`useImagePicker`](src/components/shared/useImagePicker.ts)
(hidden input, click-to-open, drag-and-drop, validation) and
[`ImageCropDialog`](src/components/shared/ImageCropDialog.tsx) (the cropper and
the queue). `AvatarPicker` is the single-round-crop case built on both.

Limits, and where each comes from: PNG/JPG/WebP · 10 MB source (a decode
ceiling, refused client-side) · 8 MB upload (`blob.py`) · 512 px output, WebP
with a JPEG fallback. **What is stored is a URL, never the image** — the API
rejects `data:` and a local `file://` path, for the reasons in
`api/app/core/images.py`.

The technician app runs the same flow with its own chrome: tap the avatar →
camera-or-library sheet → `CropScreen` → upload. Drag-and-drop has no meaning
there; everything else matches.

## Images

Placeholders only, in `public/images/placeholders/` — `hero-placeholder.webp`,
`company-placeholder.webp`, `service-placeholder.webp`, `client-placeholder.webp`,
`case-study-placeholder.webp`. This app additionally needs proof-capture placeholders:
`proof-barcode-placeholder.webp`, `proof-serial-placeholder.webp`,
`proof-product-placeholder.webp`, `proof-geo-placeholder.webp`. Every path is referenced through
one `utils/images.ts` map so swapping in real assets is a single-file change.

---

## Commands

```bash
cd adminWeb
npm run dev
npm run lint        # must pass before every commit
npm run typecheck
npm run build
```

## Commit rhythm

**One commit per completed screen**, after `lint` and `typecheck` pass. Conventional Commits:
`feat(escalations): bonus setup and re-notify sheet`.

---

## Decisions still open

Blocking or near-blocking. Do not silently pick a side.

1. **Penalty bands contradict the mobile app.** This prototype: **₹300** (>4h) · **₹500** (2–4h) ·
   **₹800** (<2h) · **₹1,200** (no-show), cap ₹5,000/technician/month. `mobileapp/AGENTS.md` and
   the technician app: **₹80** (>8h) · **₹150** (4–8h) · **₹250** (<4h). Different amounts *and*
   different band boundaries — the technician's cancel screen and the ASM's ledger would show
   different money for the same event. **Needs a ruling before either side binds to an API.**
2. **Bandwidth model contradicts itself.** Rules Config says "Weighted by job type";
   `mobileapp/AGENTS.md` says a simple 1–12/day cap; the requirement doc leaves it open — and this
   prototype's own technician records use plain counts (`bwUsed 3 / bwTotal 5`).
3. **RBAC scoping is undesigned.** Territory defines Region → RSH → ASM → pincodes, but no screen
   shows what an NH sees that an ASM doesn't.
4. **Dark palette is unapproved** (see Theme).

### Answered by this prototype, still open in the requirement doc

Wait before manager closure **48h** · AI confidence threshold **70%** (slider 50–95) ·
slot-confirm timeout **6h → auto-escalate**. Treat these as decided; the doc's §11 is stale.

## Domain facts that are easy to get wrong

- The **customer confirms the slot before any technician sees the job.** Technicians accept a
  fixed time; they never propose one.
- Assignment is **first-accept-wins**.
- **Customer name, phone and address stay masked until a technician accepts.** The admin sees them
  throughout — the masking rule is the technician app's, not this one's.
- Escalation fires when a ticket is **still unassigned within 4h of its slot** — not the moment a
  technician cancels.
- Penalties fund a **pool**; the pool funds **escalation bonuses**. Money in equals money out.
- Proof is **four** artifacts: barcode, serial, product photos, geo-tagged live photos. Gallery
  uploads are never accepted; geo is validated against the ticket **pincode**.
- AI verification has **three** outcomes: match → closure · mismatch → ASM review · unreadable →
  retake on-site before leaving.
- Force-closure **requires** attachments and records who, when, and on what basis. Audit is a
  stated requirement, not a nicety.
