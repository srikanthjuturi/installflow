# Reliance GreenTech · Ops Console (adminWeb)

The **web admin portal** for the Reliance GreenTech installation & demo service — the ops/management half
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
   **They are not part of the Reliance GreenTech palette.**

To run the prototype: serve `webdesign/` over HTTP and open `Admin Portal.dc.html`. Login is
prefilled (`ravi.sharma@reliancegreentech.in` / `demopass`); any 6 digits pass OTP.

## Phase: partly bound

`services/http.ts` is the real transport. Live: auth, companies, **users & roles**, territory,
**the geography master** (`/geo/*`, including the Excel importer), the **product master**
(`/masters/*`) and **technicians** (`/technicians/*`, `/onboarding/*`).

Tickets, escalations, the ledger, vendors, notifications, search, earnings and Rules config are
live too. What is still mock is **AI review** (`services/ai.ts`), the bulk **importer**, and two
functions in `services/settings.ts` (`inviteUser` and its sibling) — so binding each stays a
one-line change and loading / empty / error states are already there.

**The dashboard is live**, over `GET /tickets/summary`. It sits in the tickets slice rather than
a `dashboard` one because every figure on it is a ticket count and hard rule 4 forbids a second
slice importing `scoped()` — a second copy of the visibility rule is the copy that drifts. Two
things about it are worth knowing before editing:

- **Every count is the SAME predicate as the screen it links to.** The SLA buckets reuse
  `_sla_order_case`, so a tile and the board rank one ticket the same way; the escalation figure
  is `list_escalations`' LIVE half, so it equals the red banner on the page it opens. The two
  sweep-derived cards drop the sweeps' notification de-dupe on purpose — a ticket does not stop
  needing a manager because a bell already rang for it.
- **There are no delta chips, and that is not an oversight.** A movement needs the same count as
  it stood earlier, and nothing records that: no snapshot table, and today's rows cannot answer it
  because a ticket closed on Tuesday was open on Monday and leaves no trace. `Kpi.delta` is
  optional and `KpiRow` draws no pill without one. Restore the chips only with a real source
  behind them.
- **The filters narrow and can never widen.** `regionId` / `stateId` / `dateFrom` / `dateTo` go
  through `service.narrowed()`, whose territory clause is a pincode subquery ANDed with
  `scoped()` — so naming somewhere outside your own territory intersects to nothing and reads
  zero. There is deliberately **no separate permission check**: one that could drift from the
  picker is worse than none. Verified per role — a Telangana area manager naming any other region
  reads 0, never that region's real figures.
  The picker offers only what the caller may see (`/geo/*?mine=true`); that is presentation, not
  security. Dates bound **intake** (`created_at`), not the slot: a slot is nullable, so bounding
  on it would silently drop every unbooked ticket — exactly what the "Slot not confirmed" card
  counts. Filters live in the query string, so a view is a link.
- **`list_tickets` takes the same four, and must keep doing so.** The peek table under the tiles
  reads that endpoint. When only the summary was filtered, a dashboard narrowed to one region
  read zero everywhere above six rows from another — which is why the narrowing is one shared
  helper rather than two call sites that agreed on the day they were written.
- **Zero is a normal state now.** A territory or a date range can legitimately match nothing, so
  `SlaPanel` draws a filled `bg-chart-empty` bar at a total of 0; three zero-width segments render
  as a bare strip that reads as a chart that failed to load.
- **Every card opens a list holding exactly what the card counted.** A count that disagrees with
  the rows behind it is worse than no count. Two things make it hold, and both must survive:
  the Escalations card links with **`half=live`** (it counts the savable half; the queue also
  carries a missed pile that only grows, so the unfiltered link showed seven rows under a card
  saying two), and every card carries the dashboard's own four filters through `linkTo()`.
  `list_escalations` and `list_tickets` both accept them and apply the same `narrowed()` the
  figures came from. Verified across all five roles, unfiltered and narrowed.
- **A filter the destination cannot show must announce itself.** The escalation queue has no
  control for territory or intake dates, so arriving with them set would hide rows with nothing
  on screen to explain it. `NarrowedNotice` names them and offers "Show the whole queue". Its
  `half` pill, by contrast, needs no notice — it is a visible control that reflects the URL.
- **The queue's filters live in the query string.** They were `useState`, which is why
  `?half=live` was ignored and the card's link did nothing. A filter in component state cannot be
  linked to, and this screen is a link target.
- **The dashboard's filter bar emits a PATCH, not the whole set.** `onChange({ stateId })` names
  only what changed, and `setFilters` merges it onto the live URL through `setSearchParams`'
  functional form. Passing the whole object let two changes in one tick clobber each other —
  the same hazard `useTicketFilters` solves with its pending ref.

Two seams to know about:
- `services/client.ts` is the MOCK transport, `services/http.ts` the real one. Both unwrap the
  same envelope, so a slice moves between them without touching its hooks.
- `listCandidateTechnicians` is the one shortlist, and it is live: active, certified for the
  ticket's subcategory, covering its pincode. Pass the ticket's `slotStart` (it travels as `onDay`)
  and `bwUsed` counts the load on the day the work HAPPENS — without it the shortlist for a Friday
  job shows Monday's numbers and the manager picks somebody the assign call then refuses at cap.
  Its mock predecessor `listEligibleTechnicians` is gone, along with the flat `EligibleTechnician`
  shape it needed. A candidate for a job IS a `Technician`; the parallel type was the reason the
  queue could never be opened from a real ticket.
- **Force-closure is real.** `POST /tickets/{id}/force-close` behind the `jobs.force_close`
  feature plus an Area-Manager rank floor; the files go up first through
  `POST /uploads?kind=attachment` (PRIVATE container, blob names not URLs) and are read back
  signed from `GET /tickets/{id}/attachments`, which is **staff-only** — see below. Allowed on any
  non-terminal ticket, because it is the only exit from the live set apart from a customer
  confirming: nothing writes `Cancelled`, so without it a silent customer leaves an immortal
  ticket. A `force_closed` event carries who, when and the reason + justification, and the
  technician is credited (`jobs_completed` counts `Closed` **and** `Force-Closed`).

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
| `reliance-greentech-tech-app` | the technician side. Load it when a rule must match across both apps (penalties, proof, statuses) |
| `polished-react-site` | animation/motion patterns only. Its marketing-site conventions do **not** apply to a console |

### When to reach for which

- `frontend-design` + `tailwind-design-system` → before building `theme.css` or any new screen.
- `shadcn` → before adding any shadcn component; never hand-roll a primitive it ships.
- `vercel-react-best-practices` / `vercel-composition-patterns` → before splitting a screen into
  child components, and on any "why is this re-rendering" question.
- `typescript-advanced-types` → the discriminated unions for ticket status and AI outcome.
- `webapp-testing` → every list screen and every destructive flow (force-close, assign, bonus).
  ⚠ **Routes are lazy, so the URL changes BEFORE the destination mounts.** React Router swaps the
  address while the chunk is still loading and leaves the previous screen — including its Back
  button — in the DOM, and `wait_for_load_state("networkidle")` returns during that window. Wait
  for a selector only the destination renders before touching any control. Skipping this clicks
  the page you just left: it reported a broken back button on Force close that was never broken,
  and mislabelled a passing assertion, twice, before the cause was found.
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
  public/
    _redirects          Netlify SPA fallback — see Deployment
    images/placeholders/
  src/
    components/
      dashboard/          KpiRow · SlaBar · FunnelStrip · AttentionCards · RecentTickets
      tickets/            TicketTable · TicketFilters · StatusBadge · SlaBadge · TimelineEvent
                          FactGrid · ProofGrid · ManualEntryForm
      vendor/             VendorShell · PortalNav · portalNav.ts · AddVendorUserDialog
                          — the vendor PORTAL, a third shell. See below.
      escalations/        EscalationCard · BonusPicker
                          — `EligibleTechTable` went with the mock queue; the
                            shortlist is `tickets/CandidateTechTable`
      notfound/           DispatchRadar — the `0` of 404, on-domain rather than stock art
      ai-review/          AiQueueTable · ConfidenceMeter · SerialCompare · ProofLightbox
      technicians/        TechTable · BandwidthBar · TechProfileHeader · JobHistoryTable
      masters/            VendorTable · TerritoryTree · CategoryTree · UserTable
                          NodeFormDialog · ModelFormDialog · ParameterFields
                          — one dialog for every catalogue level; the tree is
                            recursive and `CategoryFormDialog`/`SubcategoryFormDialog`
                            merged into `NodeFormDialog` when depth stopped being fixed
      settings/           SlaRuleList · PenaltyBandTable · ThresholdSlider
                          RulesForm (company) · NodeRulesForm (a category's overrides)
      shared/             AppShell · Sidebar · Topbar · RoleTabs · PageMeta · DataTable
                          EmptyState · ErrorState · TableSkeleton · ConfirmDialog · Money
                          FilterPills · PaginationControls · ThemeToggle · LoadMore
                          FieldGrid — see the hard rule under "Reusable components"
      ui/                 shadcn/ui primitives (generated — do not hand-edit)
    pages/
      dashboard/DashboardPage.tsx
      tickets/            TicketListPage · TicketDetailPage · ManualEntryPage
                          BulkUploadPage · ValidationResultPage · ForceClosePage
      escalations/        EscalationQueuePage
                          — `BonusSetupPage` moved to `tickets/`, beside its
                            assign sibling; `ManualAssignPage` was the mock's
                            duplicate of it and is gone
      ai-review/          AiQueuePage · AiReviewDetailPage
      technicians/        TechnicianListPage · TechnicianProfilePage
      ledger/LedgerPage.tsx
      masters/            VendorsPage · TerritoryPage · CategoriesPage
      settings/           RulesConfigPage · UsersRolesPage
      auth/LoginPage.tsx
      NotFoundPage.tsx    the `*` route — eager, not lazy
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

**The `DataTable` toolbar is one row of 40px controls, and they all agree.** Search, filters, the
Rows picker and the page's action buttons share a height (`h-10`), a fill (`bg-surface`) and an
edge (`border-input`, the step-darker field colour — see the note beside `--input` in `theme.css`).
Two rules keep it that way:

- **A toolbar button is `size="toolbar"`, never `className="h-10"`.** The hand-written height
  raised the box but left `size="default"`'s 10px padding, so eight pages drew a stretched pill.
  An `outline` button additionally gets a compound variant there, because plain `outline` fills
  itself with `bg-background` — which IS the page colour, so on a page (rather than in a dialog)
  it painted itself invisible.
- **The row is two zones: search on the left, everything else pinned right.** The filters, the
  Rows picker and the page's buttons live in ONE `grow … justify-end` group. `grow` is what makes
  it claim the space the search box does not want, so its contents end at the row's right edge and
  the leftover reads as a deliberate gap. Not `ml-auto`: an auto margin eats free space *before*
  flex-grow runs, which would freeze the search box at its basis.
- **The right zone is one flex item, not loose siblings.** That is what holds the alignment at the
  width where things stop fitting: a `grow` group fills whatever line it lands on, so every line it
  wraps into stays pinned right. As siblings the row broke wherever the last control fell and
  dropped the page's buttons to a second line flush *left*, stranded under the search box.
- **Every filter is `w-40 shrink-0` — one fixed width, select and combobox alike.** Sized for the
  longest label the console has ("Intake channel: all"). Fixed rather than flexible so a filter's
  width never depends on how many filters that screen happens to have; `shrink-0` because a filter
  squeezed too narrow to read its label is worse than one that wraps to the next line.
- **The search box is `grow basis-40 max-w-80`** — it grows into the gap so its placeholder comes
  back on a roomy screen, and stops, because an 800px-wide search field is not a better one. Past
  the cap the right-hand group takes the rest.

**There is no content max-width.** `AppShell`'s `<main>` is fluid and every screen inherits it —
a console is a work surface, so a wide monitor should buy more table, not more margin. Never add
`max-w-*` to a page root or a full-width card. (The prototype caps content at 1360px; that is the
one place we deliberately depart from it.) Constrain reading width only where a long paragraph
would otherwise stretch — a form column, a justification note — never a table or a card grid.

### Chart / categorical colour

`--chart-1…4` is the **categorical series palette** — identity, never magnitude and never state.
Assign the hues in fixed order and never cycle them; a fifth series folds into "Other" rather
than inventing a colour. `--chart-empty` is the "no data" step, not a fifth hue.

They were `brand-500 / info / ok / warn / danger` and had **zero call sites**, which was lucky:
that set fails three of the five palette checks, and it reused the status colours, so a series
would have been tinted "danger red" purely for being fourth in a list. The current values are
validated — run the `dataviz` skill's `validate_palette.js` before changing one, on the light
surface *and* on the dark `#171a23`, and don't eyeball ΔE.

Two constraints the validator output imposes, both recorded in full in `theme.css`:

- **All-pairs colourblind separation is ΔE 7.6** (magenta↔teal, deutan). That is legal ONLY with
  a secondary encoding, so anything using three or more of these at once must also carry a direct
  label, a gap or a texture. Colour alone is never the encoding.
- **White text on these fills is LARGE-TEXT only** (contrast 5.47 / 4.06 / 3.78 / 5.79). A label
  on a filled mark must be ≥18.66px **bold**. Darkening the two low ones to fix it was tried and
  is worse — it turns the ΔE 7.6 WARN into a hard FAIL at 5.9.

### The India map

`components/geo/IndiaMap.tsx` draws real state boundaries. It lives in `geo/`, not under
`superadmin/`, because **two pages use it and they are on different surfaces**: Geography is
superadmin-only, Territory is a company page behind `require_feature("territory.view")` — which
403s a superadmin. Moving it also split it into its own chunk, so the two pages share one 79 KB
copy of the outlines instead of bundling them twice.

**The map owns geometry and interaction; the page owns meaning.** It takes a `markFor(state)`
returning a `StateMark` — fill class, active, marked, interactive, detail — plus a `legend` slot.
Geography colours by REGION (identity, `--chart-1..4`); Territory colours by COVERAGE (status,
`ok`/`warn`), which is the one legitimate use of the reserved status colours. Neither meaning
belongs inside a component that knows about pinch gestures.

**The whole country stays in frame at every level.** Picking a region marks its states where they
sit; picking a state marks that one. Nothing zooms on selection. An automatic zoom was built first
and removed: it threw away the one thing a map is for — showing you *where* something is — and it
left the cursor hovering a neighbour once the animation settled, which is how "Delhi · 22 districts
· 318 pincodes" (Haryana's numbers) reached the header. Zoom and pan are asked for, by button or
by pinch.

On Territory the same rule governs scope: a state outside the caller's territory is still DRAWN,
in neutral at full opacity, but `interactive: false` so it is inert and out of the tab order. It
was tried at 12% opacity first and the northern half of the country vanished, which defeats the
reason for drawing it.

Four things about the outlines are load-bearing:

- **They are generated, not hand-held.** `scripts/gen-india-paths.mjs` extracts them from the
  `@react-map/india` devDependency into `geo/indiaPaths.ts`. Re-run the script; never patch a
  coordinate. That source was chosen over `@svg-maps/india` because it is post-2019 and carries
  **Ladakh** as its own outline — the alternative folds Ladakh into J&K and would leave a real
  state with real pincodes undrawable.
- **It must depict India's full claimed territory.** J&K and Ladakh extend through
  Gilgit-Baltistan and Aksai Chin. Publishing a map of India whose boundaries do not conform to
  the Survey of India is an offence under the Criminal Law Amendment Act 1961, so a dataset that
  draws the Line of Control instead is not a candidate however good its licence.
- **A state can own more than one outline.** Our master merged Dadra and Nagar Haveli with Daman
  and Diu; the map still has them as two landmasses either side of Gujarat. That is why 36 states
  render 37 paths.
- **Outlines are matched to states by NAME**, so a renamed state stops being drawable. It is never
  dropped silently — the map names it underneath with the reason.

**There are no district boundaries, deliberately.** The only district geometry on npm
(`@marun8.k/react-india-drilldown-map`) has transliteration-corrupted names — `>Nj>W` for Anjaw,
and in Karnataka two different districts are both called `"H"`, so Hassan and Haveri cannot be
told apart. Matching what is recoverable binds 93.5% of our districts with no false bindings, but
that leaves Karnataka at 20 of 31 and a map that looks complete while missing a third of a state.
Districts stay a complete, correct list beside the map until a licensed district boundary set
exists.

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
11. **"Back" is never hard-coded.** One route has several ways in — the board, the escalation
    queue, the ledger, a technician's jobs, the topbar search, the portal — so a written-in
    destination is right only for whichever caller the screen was built against, and silently
    wrong for every other. Whoever navigates says where they came from: `useNavOrigin(label)` on
    the way out, `readNavOrigin(location.state)` on the way in, and a fallback for the pasted link
    that carries no state. All of it is in `src/hooks/useNavOrigin.ts`.
    - **Every link to a detail route carries the origin** — the row click AND the code link beside
      it, or one of them lies. A screen that *reads* an origin nobody sends is the same defect as
      one that hard-codes: the technician profile ignored the origin global search had been
      handing it since the day it was written.
    - **An action screen forwards the trail** through `NavOrigin.backState`, so
      queue → ticket → assign → Back → Back reaches the queue. A trip through an action screen
      must not reset where the reader came from.
    - **A success handler uses `originFor(path, origin)`**, which drops an origin pointing AT the
      page being navigated to — otherwise the reader lands on a page whose Back button offers to
      take them to the page they are already on.
    - **Cancel goes where Back goes**, unless cancel means "abandon this form" — then it returns
      to the record the form belongs to, and only the trail behind it is forwarded.

    It was wrong in six places at once, all of them invisible until somebody pressed Back: the
    queue's "Assign manually" landed on the ticket, its ticket-code link and the dashboard's
    recent tickets landed on the board, and both ledger columns landed on the board and the
    roster. None of it is caught by types or lint — the only test is to walk the trail.

---

## Page-wise architecture

| Route | Page | Notes |
|---|---|---|
| `/login` | `LoginPage` | single step, two doors: email + password, or Google (button + One Tap). No OTP — signing IN never asks for a code here |
| `/forgot-password` | `ForgotPasswordPage` | three steps in local state: email → 6-digit code emailed → new password, then straight into a session. Signed-out only (under `RedirectIfSignedIn`), and it shares `AuthLayout` with `/login`. `OtpStep.tsx` was dead prototype code until this used it |
| `/` | `DashboardPage` | 4 KPI tiles · SLA stacked bar · 3-stat funnel · "Needs your attention" (4 cards, each deep-links) · recent tickets |
| `/tickets` | `TicketListPage` | status pills, search, **default sort = SLA urgency** (breach → warn → ok → done) |
| `/tickets/:id` | `TicketDetailPage` | facts grid · timeline & audit trail · customer · technician · proof-of-completion grid |
| `/tickets/new` | `ManualEntryPage` | vendor/category/model · request type · customer · SLA · submit fires the slot request |
| `/tickets/import` | `BulkUploadPage` | dropzone, 8 required columns, max 5,000 rows |
| `/tickets/import/:batchId` | `ValidationResultPage` | per-row pass/reject **with reason**; rejects never block the file |
| `/tickets/:id/force-close` | `ForceClosePage` | reason + notes + **mandatory attachments** |
| `/tickets/:id/assign` | `AssignTechnicianPage` | real ticket + a LIVE shortlist (`subcategoryId` + `pincode`, server-filtered), and a real `POST /tickets/:id/assign` |
| `/tickets/:id/bonus` | `BonusSetupPage` | bands from Rules config; pool balance shown, not enforced; re-notify reports the technicians actually reached |
| `/escalations` | `EscalationQueuePage` | unassigned within 4h of slot, in two halves under date dividers; search · Still savable/Missed · slot-date range · Refresh; loads on scroll |
| `/escalations/:id/bonus` · `/escalations/:id/assign` | — | param-preserving **redirects** to their `/tickets/:id/…` twins. The mock queue owned duplicates of both; deleting a route does not close a path (hard rule 0a) |
| `/ai-review` | `AiQueuePage` | below-threshold or unreadable |
| `/ai-review/:id` | `AiReviewDetailPage` | 4 proof images · expected vs detected serial · Approve / Reject·retake |
| `/technicians` | `TechnicianListPage` | add · invite · **edit** — one `TechnicianFormDialog` for add and edit, pointed by an optional `technician` prop. Edit is `technicians.edit` and offered on REGISTERED rows only: an invite is a phone number and nothing else yet |
| `/technicians/:id` | `TechnicianProfilePage` | bandwidth, cancels, net ledger, job history; "Edit details" opens the same dialog |
| `/ledger` | `LedgerPage` | pool balance, penalties collected, bonuses paid, transactions |
| `/vendors` · `/territory` · `/categories` | masters | territory is Region → RSH → ASM → **states**; unassigned states are named. The vendor row carries an **Address searches** column — a lifetime COUNT, always a number and never a dash, and independent of the switch that produced it |
| `/companies` · `/geography` | superadmin | the platform surface. Geography is the region → state → district → pincode master, loaded from a spreadsheet; drill-down state lives in the query string (`?region=&state=&district=`) so a view is a link |
| `/settings/rules` · `/settings/users` | settings | |
| `*` | `NotFoundPage` | every unmatched URL. Renders — it does not redirect |

**The `*` route renders a page; it does not redirect.** Bouncing an unknown URL to the dashboard
makes a mistyped link look like a successful navigation, with nothing on screen to say otherwise.
Three things about `NotFoundPage` are deliberate:

- **It is the only page imported eagerly.** A fallback that must fetch a chunk of its own can fail
  in precisely the situation it exists for — a stale deploy whose chunks have moved.
- **It sits outside all three shells.** `*` is react-router's lowest-ranked pattern, so one splat
  per shell would leave three equally specific candidates for an unknown URL and let declaration
  order pick the winner. A single top-level route is unambiguous, and it is also the only version
  that renders signed-OUT, where no shell exists to sit inside.
- **Its way back is `landingPath()`, not `/`.** Losing the sidebar means the button IS the
  navigation, and a vendor sent to `/` would bounce off the staff guard and visibly redirect twice.

It needs `public/_redirects` to be reachable at all in production — see Deployment.

**Domain types are discriminated unions.** `TicketStatus` = `New | Slot Pending | Assigned |
In Progress | AI Review | Escalated | Closed | Force-Closed | Cancelled` (9).
`SlaState` = `ok | warn | breach | done`. `AiOutcome` = `match | mismatch | unreadable` (3).

### Reusable component strategy

Three tiers. Promote downward only when a third consumer appears — two usages is a coincidence.

- **`ui/`** — shadcn primitives, generated, never hand-edited.
- **`shared/`** — cross-slice: `AppShell`, `DataTable`, `EmptyState`, `ErrorState`,
  `TableSkeleton`, `ConfirmDialog`, `PageMeta`, `Money`, `StatusBadge`, `FilterPills`,
  `FieldGrid`.
- **`<slice>/`** — everything else, private to its feature.

Nine of the twenty screens are a filtered table over a domain list. Build **one** `DataTable`
(column defs, sort, empty/loading slots) and configure it; do not write nine tables.

**Nothing deletes or suspends on a single click.** Every destructive action goes through
`shared/ConfirmDialog`, whose title NAMES the row it is about ("Suspend Sunil Pawar?") and whose
description says what follows and how to undo it. Three details of it are load-bearing:

- **It does not close itself on confirm.** The caller closes in the mutation's `onSuccess`, so a
  failure leaves the dialog standing over the toast instead of dismissing as though it had worked.
- **A backdrop click does not dismiss it** — inherited from `Dialog`'s `disablePointerDismissal`.
- **Only the destructive DIRECTION asks.** Suspend confirms; Activate fires straight through. The
  branch belongs on the direction, never on the button.

Two things are deliberately exempt. A **form save** is already two deliberate steps (you picked
"Paused", then you pressed Save), so `EditUserDialog` and the four master form dialogs are not
intercepted. **Sign out** is fully reversible, and a modal on the shell's most-used button is
friction with no payoff. `ReissuePasswordDialog` and `ReissueVendorPasswordDialog` stay hand-rolled
because they render a temporary-password panel *after* success — that is a two-phase dialog, not a
confirm, and a primitive should not own result rendering.

### ⚠ A grid of fields is `shared/FieldGrid`, never `<FieldGroup className="grid …">`

`FieldGroup` carries `@container/field-group`, i.e. `container-type: inline-size`. Overriding its
display to `grid` makes the query container and the grid **the same element**, and Chrome then
fails to re-run that element's layout when a **sibling is inserted next to it**. The grid keeps
zero tracks and every control inside collapses to height 0 — still in the DOM, `offsetParent`
null, invisible, with no error anywhere and nothing in the console.

It is not theoretical, and it does not show on first paint. Ticket intake hit it the moment a
product was picked: choosing one inserts the "billed at ₹1,200" line beside the grid, and the
whole *Vendor & product* row vanished. It looked exactly like a bug in the drill-down logic.
Measured rather than guessed — `container-type: normal` did not fix it, `content-visibility:
visible` did not fix it, but touching *any* style property on the container, or resizing the
window by one pixel, restored it instantly. The content was always fine; only the layout pass was
missing.

`components/ui` is generated and must never be hand-edited, so the fix is `shared/FieldGrid` —
**a plain div** carrying the grid classes and nothing else.

⚠ **Wrapping the grid in a `FieldGroup` is NOT enough**, which is the counter-intuitive part and
was tried first: `<FieldGroup><div className="grid …">` reproduced the collapse on the intake form
exactly — nine controls at height 0 the moment a category was picked. A query container anywhere
above the grid inside the section is sufficient to trigger it, so `FieldGrid` renders no container
at all.

It does keep `data-slot="field-group"`, because the attribute and the class are separate concerns
and only the class makes a container: the attribute is read solely by an enclosing group's
`*:data-[slot=field-group]:gap-4`, and dropping it would shift spacing wherever these nest. The
cost is that `Field orientation="responsive"` — which queries `@md/field-group` — does not respond
inside a `FieldGrid`. Nothing in `src/` uses that variant, and a grid is already deciding the
columns; if one is ever needed, put it in a real `FieldGroup` beside the grid, not in it.

Twenty call sites were converted at once. Grep before adding another:

```bash
grep -rn 'FieldGroup className=' src/ | grep -Ei 'grid|COLS'   # should find nothing
```

---

## State management

| Kind | Home | Examples |
|---|---|---|
| Server state | TanStack Query | tickets, escalations, AI queue, technicians, ledger, rules, users |
| Client state | Zustand | session + active role, sidebar open, theme, multi-step form drafts |
| Form state | RHF + Zod | manual entry, bulk upload, bonus, force-close, rules config |
| URL state | React Router | filters, status pill, page, selected id — filters belong in the query string so a view is shareable |

Query keys are tuples: `['tickets', filters]`, `['ticket', id]`,
`['escalations', 'list', params]`. Invalidate by prefix after every mutation. `staleTime` 30s for
lists; escalations and the AI queue are time-sensitive — 10s with `refetchOnWindowFocus`.

**A key never carries the page on an infinite list.** The page is the query's own cursor, so
`useLedgerEntries` strips `params.page` before hashing and the escalation queue never puts one in:
leaving it there mints a fresh `useInfiniteQuery` — discarding every loaded page — each time the
cursor moves. The corollary is worth knowing too: an UNNARROWED escalation queue hashes to the
same key the rail's badge asks for, so the two share one request, and they part company the moment
a filter goes on.

### Lists that load on scroll

`/escalations` and `/ledger` page on scroll rather than through a pager, via `useInfiniteQuery` and
`shared/LoadMore`. Three rules come with that:

- **Narrowing happens on the SERVER, always.** Filtering the pages that happen to be loaded would
  make "no match" mean "not in what you have scrolled to" — a lie with a very plausible shape.
- **`LoadMore` renders a sentinel AND a real button.** The observer is the convenience; the button
  is what a keyboard reaches, and what somebody gets when the loaded rows are shorter than the
  viewport.
- **Pass `isFetching && !isFetchingNextPage`.** `DataTable` dims stale rows; without the second
  half, appending page two greys out everything already on screen.

`DataTable` takes `infinite` (replaces the pager) and `groupBy` (a full-width divider row wherever
the value changes between neighbours). `groupBy` divides consecutive RUNS, not buckets, so it
preserves the server's order — which means it is only meaningful on a list sorted by whatever it
groups on.

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
  (its 401 means *wrong password* — replaying resends bad credentials), `/auth/logout`,
  `/auth/google`, and all three `/auth/password-reset/*` paths. **Every auth endpoint that takes
  no bearer token belongs on that list**: its 401 is an answer, not an expired token, and
  replaying it resends the same wrong credential — for a reset, spending a second of the five
  code attempts the backend allows. Two other things happen to prevent that today
  (`RedirectIfSignedIn` keeps a session away from `/forgot-password`, and `performRefresh`
  returns early with no refresh token to present); the transport should not depend on either.
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
| Unique page titles | ✅ via `PageMeta` — `Reliance GreenTech · Escalation queue`. Drives tab + browser history |
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

**A boolean is TWO LABELLED CARDS, not a switch.** There is deliberately no `Switch` in
`components/ui/`, and adding one would be the first. Every boolean in this console — Active/Paused
on a category, a subcategory, a model and a vendor, On/Off for a vendor's address search — is a
two-option `RadioGroup` of bordered cards, because a switch's two states carry no visible word and
"never colour alone" applies to a control as much as to a badge. `StatusField.tsx` and
`AddressSearchField.tsx` are the two shapes; copy whichever fits. They are deliberately NOT one
generic component: `StatusField` is typed to `CategoryStatus` and belongs to the product master,
and the habit here is to promote a shared control on the **third** consumer, not the second.

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

## Address entry — one control, everywhere

Every postal address goes through
[`shared/AddressFields`](src/components/shared/AddressFields.tsx). Do not build a
fourth set of loose text boxes; three forms had already done that separately and
none of them checked the pincode against anything.

Five fields, and the order is deliberate: **Address → Pincode → City → State**.
The pincode DECIDES the last two, so asking for a city first and overwriting it a
moment later is the wrong order to put a person through.

1. **Search fills the fields.** Google Places, restricted to India, via
   [`useAddressAutocomplete`](src/components/shared/useAddressAutocomplete.ts).
   Picking a result writes the street line, city, state and pincode at once.
2. **The pincode is PICKED from the geography master, never typed free.** It is a
   combobox over `GET /geo/pincodes`, searchable by code, district or state —
   the same rule `technicians/CoverageFields` follows. Typing all six digits of a
   real code selects it without a click, because the digits ARE the answer.
3. **Whatever the pincode, it is checked.** `usePincodeLookup` answers three
   ways, and they are not two: a row (fine), `null` (**we do not service it —
   block submit**), or `isError` (*we could not ask* — never block; a dropped
   request is our problem, not the customer's address).
4. **Manual entry always works.** No key, no network, no matching result — every
   path ends at the same editable fields.
5. **The search is per-vendor, and the flag arrives as a PROP.** Pass
   `addressSearch={{ enabled, onSearch }}`; omit it for search-on and
   record-nothing, which is right for any form that is not a vendor's. This
   control must never read `useMe()` itself — it is `shared/`, so a component
   that looked up the session could not be reused on a staff form, and it could
   not tell the two meanings of `me.vendor === null` apart (staff → search on;
   a broken portal account → off). `VendorNewTicketPage` knows which it is.
   `enabled` goes INTO the hook rather than hiding the box at render, so a
   switched-off vendor never fetches the ~100 KB SDK. And it gates exactly one
   `<Field>` — the **pincode** combobox is ours, not Google's, and keeps working.

**The caller gates its own submit.** `zodResolver` wipes a manually-set RHF error
on the next validation pass, so `setError` will not hold. Take `onStatusChange`,
keep it in state, and disable the button on `"unknown"` and `"checking"`. Guard
`onSubmit` too — a form still submits on Enter.

Two things worth knowing before changing any of it:

- **Google has no pincode for a road or a neighbourhood** — an area that size
  spans several. Those picks seed the pincode search with the place name instead,
  so the dropdown already holds that city's codes and a lone match fills itself
  (hard rule 10). The remaining fix is the **Geocoding API**, which is NOT enabled
  on our key; the comment in `useAddressAutocomplete.ts` records what happened
  when it was tried, and it is worse than it sounds.
- **`POST /tickets` still accepts any six digits.** This rule is enforced by the
  UI alone, so the Excel importer and the vendor API intake channel can both
  still create a ticket nobody can be dispatched to.

The key is `VITE_GOOGLE_MAPS_API_KEY` in `adminWeb/.env` (gitignored). Any
`VITE_*` value is inlined into the bundle, so it is public by design and only
safe while it stays **HTTP-referrer restricted** in Google Cloud. That is also
why the per-vendor switch is a UI capability and **not a spend control** —
anyone with devtools has the key regardless.

**Reporting a search.** `useAddressAutocomplete` fires `onSearch(sessionId)` once
per Google session, after Google answers — not on mint (a session Google never
answered was never billed) and before the stale-response guard (a response
superseded by faster typing was still paid for). `VendorNewTicketPage` owns the
mutation. Two details that are load-bearing rather than stylistic:

- **A bare `useMutation`, never `useVendorMutation`.** That helper invalidates
  `vendorKeys.all`, which would make a keystroke in the portal evict console
  caches and refetch `GET /vendors` — a 403 for the vendor doing the typing.
- **`meta: { suppressErrorToast: true }` is mandatory here.** Hard rule 9 toasts
  every API failure; a vendor filling in a customer's address must never see
  "Couldn't record the search". The cost of a failure is one uncounted search,
  which is why the console's figure is a floor and not an audit.

`crypto.randomUUID` needs a secure context — fine on https and localhost, absent
on a LAN-IP origin, which this repo does use. It is guarded: no id means no
report, never a thrown search box.

## Ticket intake drills down; it does not flatten

`ManualEntryForm` asks for the vendor, then **one dropdown per catalogue level** — each filled
from the pick above it, stopping at the node marked as the last sub-category, then the product.
A flattened `Television › Android TV › OLED` select reads fine with six products and badly with
sixty, and it also hides which branch a name belongs to when two branches share one.

`useAutoSelectSingle` (hard rule 10) applies per level, so a shallow branch still costs no clicks.
Changing a level clears everything below it — `resolveChain` recomputes the whole path rather than
patching it, because a stale deeper pick is a ticket raised against the wrong product.

The product's own specs render under the billing line, read live from the model rather than
stamped: a spec is descriptive and no money moves when it changes.

## Repeating rows — the Add-field pattern

`masters/ParameterFields` is the one growable list in the app: an **Add field** button appends an
empty *Name / Value* row, `×` removes one. Two consumers today (`NodeFormDialog`'s template and
`ModelFormDialog`'s product specs), so it stays in `masters/` until a third appears.

`useFieldArray` had existed in exactly one place before this (`settings/RulesForm`) and was
**fixed length** — `append` and `remove` were never called anywhere in `src/`. Two things about
using it properly:

- **Rows are objects, never bare strings.** `{ name, value }`, keyed on `field.id`, because RHF
  remounts a row keyed by index and the input loses focus on every keystroke.
- **`useWatch`, not `watch()`.** The React Compiler is on; `watch()` returns a new value each
  render and drives a re-render loop.

The same schema builds both editors from one factory, `parameterRows(requireValue)`, because the
two differ in exactly one rule: **a template's value is optional and a product's is required.**
That is the point of the template — the leaf says which fields a product HAS, and the product
says what they are.

**A field added to the category after a product was saved is OFFERED, never merged.** Pass
`templateNames` (the model dialog does, on edit only) and `ParameterFields` shows a notice naming
what the category gained, with one button that appends those rows. Three details are the whole
design:

- **An offer, because the value is mandatory.** Merging an empty row in would make an untouched
  product invalid and stop somebody who opened the dialog to change the price.
- **Frozen at mount.** The list is computed from the values the form opened with. Recomputed
  live, deleting a row would make the notice reappear offering it straight back — and "this
  product has no Beta" is a legitimate answer.
- **Not passed when ADDING.** A new product already starts from the whole template, so the only
  thing the notice could do there is nag.

## Rules Config has a scope: the company, or one category

`RulesConfigPage` renders `RulesForm` (the company baseline, every field required) or
`NodeRulesForm` (one category's overrides, every field optional). One page in two modes beats a
second copy of six cards.

In node mode an empty box means *inherit*, and the inherited value is the placeholder with a
"from **Television**" hint beside it — so the screen distinguishes "not set" from "set to the same
number", which a plain empty field cannot. Clearing a box goes back to inheriting; `DELETE` drops
the override row entirely.

The masters tree only shows a **badge** on nodes that override something, deep-linking to
`settings/rules?node=<id>`. Rules are edited where rules live.

⚠ `BonusSetupPage` reads the **ticket's** `bonusBandsPaise`, not `GET /settings/rules`. Bands are
per-node now, and a screen that spends money must read the figure the ticket was stamped with —
otherwise per-category bonus config silently does nothing on the one screen that uses it.

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

## Deployment (Netlify)

The console is a static SPA: Netlify builds it and serves `dist/`. Only this half is on Netlify —
the API stays on Azure App Service.

**Which database you are looking at is decided by `VITE_API_BASE_URL`,** because the two API
deployments read different ones:

| Where | `VITE_API_BASE_URL` | API | Database |
|---|---|---|---|
| `npm run dev` on a laptop | `.env.local` → `http://127.0.0.1:8000/api/v1` | the one you started | `RelianceDB` (development) |
| the Netlify build | the Netlify UI variable → the Azure host | the deployed App Service | `RelianceProdDB` (production) |

Vite ranks `.env.local` above `.env`, so a local `npm run dev` or `npm run build` targets the
**local** API even though `.env` names the Azure one — which is what you want, and worth knowing
before wondering why a screen is empty. Delete or rename `.env.local` to point a local session at
production. See `api/AGENTS.md` → Environments.

| Netlify setting | Value | Why |
|---|---|---|
| Base directory | `adminWeb` | the repo root also holds `api/` and `mobileapp/` and has **no** `package.json`; a build from the root fails on the first command |
| Build command | `npm run build` | |
| Publish directory | `dist` | resolved **relative to the base directory** — not `adminWeb/dist` |
| Functions directory | *empty* | there are none |
| Branch | `main` | |

**The environment variables are mandatory, not optional.** `.env` is git-ignored, so the build
clone starts with nothing; without them the bundle calls `undefined/companies` and every screen
fails at once. Set both in the Netlify UI — never commit the values, which is the whole reason
`.env` is ignored:

- `VITE_API_BASE_URL` — the Azure API, ending in `/api/v1`
- `VITE_GOOGLE_MAPS_API_KEY` — the referrer-restricted browser key
- `VITE_GOOGLE_CLIENT_ID` — the OAuth web client id behind "Continue with
  Google" and One Tap. Public by design, like every `VITE_*`; it must match
  `GOOGLE_CLIENT_ID` on the API, which keeps it as a default in `config.py`.
  Unset is survivable — the login page renders without the button and password
  sign-in is unaffected — which is exactly what makes forgetting it easy

Node is pinned by `adminWeb/.nvmrc` (`24`), which Netlify reads out of the base directory. Keep
that file as the single source and skip a `NODE_VERSION` variable — a second declaration is one
that can drift.

**`public/_redirects` is what makes client-side routing work at all.** It is one line,
`/*  /index.html  200`. Without it Netlify resolves `/tickets` against the filesystem, finds
nothing, and returns **its own** 404 — so a refresh, a bookmark or any pasted deep link dies
before React starts, and `NotFoundPage` is never reached. `200` rather than `301` because the
address has to stay put for the router to read it.

Two prerequisites live outside this repo, and both fail silently — the build goes green and the
app is broken:

- **`CORS_ORIGINS` must name the deployed origin.** `api/app/core/config.py` ships localhost
  only; add the Netlify origin to the Azure App Service settings and restart, or the browser
  blocks every request.
- **The Maps key's HTTP-referrer allowlist must name it too.** A `VITE_*` value is inlined into
  the bundle, so that restriction is the only thing keeping a public key safe — and until the
  origin is on the list, address autocomplete fails everywhere it is used.
- **The Google OAuth client's "Authorized JavaScript origins" must name it too**, along with
  both `localhost` and `127.0.0.1` on ports 5173-5175 for development. A missing origin fails
  entirely client-side: Google refuses to initialise, the button renders as an empty box, One
  Tap never prompts, and the only evidence is a `[GSI_LOGGER]` line in the browser console — no
  request reaches the API, so its logs show nothing. The consent screen must also be **Internal**
  or **External + In production**; one left in *Testing* admits only its test-user list, which
  presents as "it works for the developer and nobody else".

## Commit rhythm

**One commit per completed screen**, after `lint` and `typecheck` pass. Conventional Commits:
`feat(escalations): bonus setup and re-notify sheet`.

---

## Decisions still open

Blocking or near-blocking. Do not silently pick a side.

1. ~~**Penalty bands contradict the mobile app.**~~ **RULED — this console's four win:**
   **₹300** (>4h) · **₹500** (2–4h) · **₹800** (<2h) · **₹1,200** (no-show), cap
   ₹5,000/technician/**calendar month in IST**. The technician app's ₹80 / ₹150 / ₹250 cutting at
   8h and 4h are gone.
   Decided on cost of change: these were already in `company_rules`, already editable per company,
   and already carried the no-show band the other scheme had no place for — while the technician's
   cancel screen needed no redesign at all, because it renders whatever the server sends. It used
   to compute the band on the DEVICE, which meant a phone with a wrong clock could talk itself
   into a cheaper penalty.
   The amounts are policy and live in the table. The BOUNDARIES are not, and live in
   `api/app/core/rules.py`: where one band ends is a fact about the clock, and a company that moved
   the cut to 3h would be showing "2–4h before slot" over a charge made at three.
   Two consequences worth carrying: **cancelling after the slot has opened is still `< 2h`, not a
   no-show** — they told somebody, and the gap between ₹800 and ₹1,200 is what speaking up is
   worth — and the API refuses a penalty list that does not ascend, so no-show can never be
   cheaper than a late cancellation.
2. **Weighted bandwidth: closed for now, and the control is gone.** Rules Config used to offer
   "Jobs per day" against "Weighted by job type". Nothing in the product ever read the answer —
   the API stores a plain `daily_job_cap`, the field app models a plain count, `BandwidthBar`
   says "never weighted" — and the field was seeded to `weighted`, so the screen asserted
   something no other surface did. It was also a **read-only display row** in the approved
   prototype, promoted to a radio by mistake.
   **Settled:** a plain count, optional (null = no limit, rendered "No limit"), no ceiling.
   **Still open:** whether capacity should ever be weighted by job type. If it should, the shape
   is a weight per service type plus a unit cap — a small table — never a two-way switch, which
   is why nothing was kept as a foundation. There is deliberately **no `bandwidth_model` column**.
3. **RBAC scoping is undesigned.** Territory defines Region → RSH → ASM → pincodes, but no screen
   shows what an NH sees that an ASM doesn't.
4. **Dark palette is unapproved** (see Theme).

### Answered by this prototype, still open in the requirement doc

Wait before manager closure **48h** · AI confidence threshold **70%** (slider 50–95) ·
slot-confirm timeout **6h → auto-escalate**. Treat these as decided; the doc's §11 is stale.

They are also no longer *answers* so much as **defaults**: every one of them is a `company_rules`
column a company can move on Configuration → Rules Config, seeded to exactly these figures.

### Where a rule lives, and the test for adding one

`GET`/`PUT /settings/rules` over `company_rules` — one row per company, `settings.view` to read
(or `jobs.assign`, because the bonus bands are spent on the escalation screen) and
**`settings.edit` to write**. Rupees on the wire, integer paise in the table.

Two settled readings that the word "monthly" and the number `0` do not carry on their own, both
now stated on the screen and in `api/app/core/rules.py`:

- **The penalty cap is a CALENDAR month in IST**, not a rolling 30 days. The cap exists to stop a
  bad month turning a technician's earnings negative, and "a bad month" is bounded by the period
  they are settled over — a rolling window would cap on one clock and pay on another, letting one
  settlement carry more than the cap. IST matches how the daily job cap already reckons a day.
  The month boundary is gameable in theory and deliberately not priced for: that is ten
  cancellations, which `technician.status` answers, not the ledger.
- **A cap of `0` means NO cap**, not "charge nothing" — a technician who should never be charged
  is one whose *bands* are zero. It is why the "cap below the largest band" check exempts zero.

**No-show is not a late cancellation**, which is why it is the priciest band rather than merely
the last one: the other three had somebody able to act, this one was discovered by the customer.
**Nothing detects one yet** — it is a label and a price until the ledger lands. `ticket_events`
already holds what that rule will read: a `reminded` with no `started` after it.

A number belongs there when a company could sensibly answer it differently. It does **not** when
it is vocabulary the system is built from. Two removals make the line concrete:

- **SLA windows** were a read-only card here, naming two service levels ("24 hours from slot
  confirmation") where the API has four (`SERVICE_LEVEL_HOURS = (12, 24, 36, 48)`) and measures
  from ticket CREATION — the reading `api/app/core/tickets.py` adopted by name against this
  screen. A settings page restating a settled rule backwards is worse than one that omits it.
  The live answer is the ticket list's SLA column and badge.
- **`SWEEP_INTERVAL_SECONDS`** stays in `Settings`. How often a worker wakes is infrastructure,
  and it is the resolution limit every timing rule here is subject to.

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
- **A force-closure's attachments are staff-only; its proof images are not.** Proof is the work
  the vendor is billed for and they may see it. The attachments are the OFFICE's justification for
  closing without the customer, and the vendor is the outside party the decision was taken about —
  so `list_attachments` refuses a vendor principal with a 404 while `list_proof` does not. The
  vendor still learns it happened and why: the `force_closed` event is on the timeline they
  already read. The console renders that panel ops-only too, but that is presentation — hard rule
  8 is why the refusal is in the service.
- **Force-close attachments skip the crop dialog**, and that is the one deliberate exception to
  *Image upload — one flow, everywhere* above. Cropping evidence removes the thing it was attached
  to prove. Multi-select, straight to upload; the only client-side gate is the content type and
  size blob storage will accept anyway.
- **A technician's mobile number is not editable — anywhere.** The phone IS the credential: auth is
  OTP only, so there is no password to fall back on and moving the number would strand somebody on
  a login nobody recorded. `PUT /technicians/{id}` does not accept it, and the edit form shows it
  read-only for the same reason the vendor form shows the login email read-only.
- **An empty daily-job-cap box means NO LIMIT, never zero.** That is why the edit form's field is a
  string and the API distinguishes an absent key from an explicit `null` (`model_fields_set`). A cap
  of 0 would mean "never offer me work", which is what going offline says instead.
