# Task 09 — Console: the franchise portal (`/franchise/*`)

> Layer: **adminWeb**. Depends on **Task 05** (technician ops move to the franchisee), **Task 06**
> (employees and statements), **Task 08** (Franchisees screen, `FRANCHISE_ROLES`, Type field) and the
> principal work of **Task 02** / ticket scoping of **Task 04**. Read [00-index.md](00-index.md) first.
> Facility screens and the parts queue are **Task 13**, which adds entries to the table this task builds.

---

## 1. Goal and why

A franchisee admin signs in to the same console a National Head uses, but must land somewhere else:
a third shell beside staff (`/`) and vendor (`/portal`), showing only **their** franchisee's
technicians and money, under **their company's** brand.

> **Worked example.** Anil is the franchisee admin of *SkyFix Services*, which runs pincodes
> 500030–500040 under the *Acme Appliances* name. He signs in at the console with the temporary
> password Task 08 emailed him.
>
> He lands on `/franchise/technicians`. The rail's header shows Acme's tile (**ACM**) with
> *Acme Appliances* and, under it, *SkyFix Services*. The tab reads *Acme Appliances · Technicians*.
> The rail offers **Technicians · UPI changes · Redemptions · Penalty & bonus pool · Employee
> statements · Tickets** — nothing of the staff console.
>
> He invites a technician: the Region box fills itself (SkyFix's pincodes are all in South), the
> pincode search only offers 500030–500040, and he picks **Employee**. A UPI change request arrives;
> the **UPI changes** badge shows 1, the row opens the technician's profile where the same panel
> Area Managers use offers **Approve change**. On **Redemptions** he pays Ravi by scanning the QR, exactly
> as a National Head does on the staff side. On **Employee statements** he picks *September 2026* and
> downloads one CSV per employee for payroll. **Tickets** lists SkyFix's tickets with no Reassign,
> Reschedule or Force-close anywhere.
>
> He pastes `/technicians/…` from a colleague at Acme: he is sent back to `/franchise`. He changes
> the id in `/franchise/technicians/<id>` to one of *Acme Secunderabad*'s technicians: the page says
> **Couldn't load this technician** — the API answered 404.

The point of the task is that **none of those screens is written twice.** The technician list,
profile, form, invite, UPI panel, redemption queue and page, pool summary and ledger table are the
staff components, pointed at the portal's endpoints and routes by a **workspace adapter** (§5.2).

---

## 2. Decisions implemented

| From index | What the portal does |
|---|---|
| F7 | Technicians and their money (add, invite, edit, type, UPI approval, redemption payment, penalty reversal, pool, employee statements) live here; ticket **work** stays on the staff side. |
| F8 | A **home** franchisee's admins get this portal too, alongside the staff who keep today's rules. Nothing client-side distinguishes home here — the server scopes. |
| F10 | Franchise roles sign in to the same console and land in `/franchise/*`, a third top-level branch with its own shell. |
| F12 | The pool screen reads the franchisee's own pool (`/franchise/ledger/pool`). |
| F13 | Tickets are **read-only**: list + detail, `actions={null}`. Facility staff see the tickets the server gives them (those with a part request). |
| T1–T4 | The Type field (Task 08's `TechnicianTypeField`) on add/invite/edit; employees appear on Employee statements; redemption is the server's refusal for an employee, nothing client-side. |
| §3.4 | Every rail entry carries a **required** `franchise.*` feature key; the guard **denies** anything the table does not name (the vendor portal's polarity). |
| §3.7 | Folders `pages/franchise/`, `components/franchise/`, nav table `franchiseNav.ts`. |

---

## 3. Schema

None. This task is client-only.

---

## 4. API contract assumed

Standard envelope; paginated envelope for lists; `/api/v1` prefix. **Every `/franchise/*` endpoint
takes its franchisee from the principal (`Principal.franchisee_id`, Task 02) — the client never sends a
franchisee id.** Another franchisee's or another company's id → **404** (index §5.1, second wall).

### 4.1 Identity (Task 02)

`POST /auth/login` — `user.role` may now be `franchisee_admin`, `facility_admin` or `facility_operator`.

`GET /auth/me` gains:

```jsonc
{
  "user": { "...": "...", "role": "franchisee_admin", "roleLabel": "Franchisee Admin" },
  "activeCompany": { "id": "…", "name": "Acme Appliances", "code": "ACM", "...": "..." },
  "role": "franchisee_admin",
  "features": ["franchise.technicians", "franchise.payouts", "franchise.pool",
               "franchise.settings", "franchise.statements", "franchise.tickets",
               "franchise.facility_users", "parts.handle"],
  "regions": [], "states": [],
  "vendor": null,
  "franchisee": { "id": "6f0c…", "name": "SkyFix Services", "code": "SKY",
                  "kind": "external", "isHome": false }   // null for every non-franchise role
}
```

If Task 02 also sends a top-level `franchiseeId`, the client ignores it and reads `franchisee.id`.

### 4.2 Technicians (Task 05) — twins of `/technicians/*`, same shapes

| Method & path | Gate | Notes |
|---|---|---|
| `GET /franchise/technicians` | `franchise.technicians` | `Page<TechnicianRow>` (registered + invites), same params and filters as `GET /technicians`, plus `technicianType`, `view=registered`. Rows carry Task 08's `franchiseeId`, `franchiseeName`, `franchiseeIsHome`, `technicianType`, `canManage` (always true here). |
| `GET /franchise/technicians/{id}` | `franchise.technicians` | `Technician`; 404 outside the franchisee. |
| `POST /franchise/technicians` | `franchise.technicians` | `CreateTechnicianInput` + `technicianType`; `regionId` optional when the franchisee's pincodes sit in one region. A pincode outside the franchisee → 422 `PINCODE_OUTSIDE_FRANCHISEE` naming the codes. Returns `CreatedTechnician`. |
| `PUT /franchise/technicians/{id}` | `franchise.technicians` | `UpdateTechnicianInput` + `technicianType`. |
| `DELETE /franchise/technicians/{id}` | `franchise.technicians` | |
| `POST /franchise/technicians/{id}/app-link` | `franchise.technicians` | `AppLinkOutcome`. |
| `GET /franchise/technicians/{id}/upi-change` | `franchise.payouts` | `UpiChange \| null`. |
| `POST /franchise/technicians/{id}/upi-change/approve` · `/reject {reason}` | `franchise.payouts` | `UpiChange`; 409 `NO_PENDING_CHANGE` as today. |
| `POST /franchise/technicians/invites` · `/invites/{id}/resend` · `DELETE /invites/{id}` | `franchise.technicians` | `InviteTechnicianInput` + `technicianType`. |
| `GET /franchise/technician-options` | `franchise.technicians` | Pick lists the staff form gets from staff-only endpoints (`/masters/nodes` is `masters.view`, regions are territory-scoped). See below. |
| `GET /franchise/pincodes?page&limit&search&regionId` | `franchise.technicians` | `Page<GeoPincode>` — the same row shape as `GET /geo/pincodes`, limited to codes this franchisee owns (home: the catch-all set, `franchisee_pincodes_subquery`). |
| `GET /franchise/upi-changes?page&limit&state` | `franchise.payouts` | `Page<UpiChangeRow>`; `state` ∈ `pending` (oldest first), `approved`, `rejected`; absent = all, newest first. |
| `GET /franchise/upi-changes/count` | `franchise.payouts` | `{ "pending": 1 }` — the rail badge. |

```jsonc
// GET /franchise/technician-options
{
  "regions": [ { "id": "…", "name": "South" } ],          // regions holding ≥1 pincode this franchisee owns
  "subcategories": [                                       // CERTIFY_DEPTH nodes, active, company-wide
    { "id": "…", "name": "Television", "rootId": "…", "rootName": "Electronics", "pathLabel": "Television" }
  ]
}

// UpiChangeRow = UpiChange (src/types/technician.ts) + who it is for
{ "...UpiChange": "…", "technicianId": "…", "technicianName": "Ravi Teja", "technicianCode": "TCH-4021" }
```

**Decision (writer): a dedicated options endpoint, not `masters.view` for franchise roles.** Granting
`masters.view` would hand a franchisee admin the whole catalogue read surface (serial lookup, vendor
options) to fill one checkbox list; the options endpoint returns exactly the two lists the form needs.

### 4.3 Redemptions and pool (Task 05) — twins, same shapes

| Method & path | Gate | Same shape as |
|---|---|---|
| `GET /franchise/redemptions?page&limit&state` · `GET /franchise/redemptions/count` · `GET /franchise/redemptions/{id}` | `franchise.payouts` | `/redemptions…` (`Redemption`, `{ toPay }`, `RedemptionDetail` with `upiUri`) |
| `POST /franchise/redemptions/{id}/claim {proof, utr?}` · `/decline {reason}` | `franchise.payouts` | `RedemptionDetail` — still **no confirm**; only the technician confirms. |
| `GET /franchise/ledger/pool` | `franchise.pool` | `LedgerPool` (`services/ledger.ts`), computed per F12 for this franchisee. |
| `GET /franchise/ledger?page&limit&kind&sortBy=date&sortDir=desc` | `franchise.pool` | `Page<LedgerEntry>` — pool kinds only, this franchisee only. |
| `POST /franchise/ledger/{entryId}/reverse {reason}` | `franchise.pool` | `LedgerEntry` (the new `reversal`). Entry must be a reversible kind (`penalty`, later `speed_penalty`) of this franchisee; 409 `PENALTY_ALREADY_REVERSED`; reason 3–160 like the staff route. |

**Decision (writer): a franchisee admin reverses a penalty from the Pool screen, not the ticket page.**
F7 gives them reversal; F13 makes their ticket page read-only. The staff side put Reverse on the ticket
page only because an Area Manager cannot open the ledger — a franchisee admin owns the pool, so its rows
are the natural place. *If Task 05 instead opens `POST /tickets/{id}/penalties/{entryId}/reverse` to
franchise principals, only the adapter's `ledger.reverse` changes.*

### 4.4 Employee statements (Task 06)

| Method & path | Gate | Returns |
|---|---|---|
| `GET /franchise/statements/{technicianId}?month=YYYY-MM` | `franchise.statements` | `text/csv` (UTF-8, BOM). `month` is an IST calendar month, not in the future. A technician who is not an employee of this franchisee → 404. Bad month → 422. |

The employee list itself is `GET /franchise/technicians?view=registered&technicianType=employee` —
**no summary endpoint is assumed.** *If Task 06 ships one (per-employee totals for the month), the page
adds columns; nothing else moves.*

### 4.5 Tickets, notifications, socket (Tasks 04/05) — reuse of the staff endpoints

**Decision (writer): the portal reads tickets through the existing `/tickets` endpoints, scoped by the
principal — exactly as the vendor portal does — not through `/franchise/tickets` twins.**
`TicketDetailPage` fans out to `GET /tickets/{id}` and `GET /tickets/{id}/proof` from inside shared
components; twins would mean threading a second source through every panel for a read-only view.

So Task 04 must make these accept a franchise principal holding `franchise.tickets` (today they are
`jobs.view`), scoped as F13 says:

| Endpoint | Franchise scoping |
|---|---|
| `GET /tickets` (incl. `?technicianId=`, used by the technician job history) | `franchisee_admin`: `tickets.franchisee_id = principal.franchisee_id`. Facility roles: that, AND the ticket has ≥1 `spare_part_requests` row (none until Task 12). |
| `GET /tickets/{id}`, `GET /tickets/{id}/proof` | Same predicate; outside it → **404**. |
| `GET /tickets/{id}/attachments` | **404** for franchise principals (staff-only, like vendors). |
| Every ticket write | Refused for franchise principals (no `jobs.*` write keys). |
| `GET /notifications`, the bell's count, read/unread writes | Audience `franchisee_admin` / `facility` matched on `notifications.franchisee_id` (Task 05, index §3.2). Routes are written **staff-style** (`/technicians/{id}`, `/redemptions/{id}`, `/tickets/{id}`); the console rewrites them (§5.8). |
| Ticket socket (`useTicketStream`) | Admits a franchise principal and scopes `notification.raised` the same way. |

---

## 5. Client changes

All paths under `adminWeb/src/`.

### 5.1 Session and routing — the third shell

| File | Change |
|---|---|
| `types/api.ts` | `BackendRole` gains the three franchise roles and `FRANCHISE_ROLES` (Task 08 adds both; this task relies on them). `MeResponse.franchisee: MeFranchisee \| null`; `MeFranchisee { id; name; code; kind: "internal" \| "external"; isHome }`. |
| `lib/surface.ts` (**new, pure**) | `type Surface = "superadmin" \| "franchise" \| "vendor" \| "ops"`; `surfaceOf({ superadmin, franchise, portal })` — order **superadmin → franchise → vendor → ops**; `SHELL_PATHS: Record<Surface, { home; notifications; account; password }>` (`ops`: `/`, `/notifications`, `/account`, `/account/password`; `vendor`: `/portal`, `/portal/notifications`, `/portal/account`, `/portal/password`; `franchise`: `/franchise`, `/franchise/notifications`, `/franchise/account`, `/franchise/password`; `superadmin`: `/companies`, …). Plus the workspace paths of §5.2. |
| `store/session.ts` | New persisted flag **`franchise: boolean`**, set in `signInBackend` from `FRANCHISE_ROLES.includes(user.role)`, cleared by `signOut`, added to `partialize`. `landingPath(s: { superadmin; portal; franchise })` becomes `SHELL_PATHS[surfaceOf(s)].home` — **`franchise` is a required field**, so the compiler finds all five call sites. Persist **`version: 7`**: `migrate(persisted, from)` keeps a v6 session and derives `franchise` from `backendUser?.role` (a v6 session predates nothing that decides routing except this flag, so nobody is signed out); anything older keeps today's reset. Comment on `landingPath` updated: it is still THE one place the surfaces are ranked. |
| `routes.tsx` | `RequireAuth`: `if (franchise) return <Navigate to="/franchise" replace />` beside the portal bounce. `RequirePortal`: same bounce for `franchise`. `RequireSuperadmin`: non-superadmin → `landingPath(...)` instead of `/` (saves a visible double redirect for a franchise user). `RedirectIfSignedIn` passes `franchise`. New `RequireFranchise` (mirror `RequirePortal`) and **`RequireFranchiseFeature`** (mirror `RequirePortalFeature`: `FRANCHISE_UNGATED` passes; `loading` → `PageSkeleton`; `featureForFranchisePath(pathname)` must exist **and** be held, else `<Navigate to={franchiseLanding(has)} replace />`). Route tree in §5.6. |
| `pages/auth/LoginPage.tsx`, `pages/auth/ForgotPasswordPage.tsx`, `pages/NotFoundPage.tsx`, `pages/notifications/NotificationsPage.tsx` | Pass `franchise` to `landingPath`. `NotFoundPage`'s label gains `franchise ? "Back to the portal"`. |
| `components/shared/NotificationBell.tsx`, `pages/account/AccountPage.tsx`, `pages/account/ChangePasswordPage.tsx` | Replace each `portal ? "/portal/…" : "/…"` with `SHELL_PATHS[surface].…` where `surface = surfaceOf(useSession())`. Three call sites today, four after this task — one table instead of nested ternaries. |
| `store/recentlySeen.ts` | `!portal` → `surface === "ops"` (the franchise shell has no global search either). |

### 5.2 The workspace adapter — how the staff screens are reused without forking

The staff technician / redemption / pool screens differ from the portal's in exactly three things:
**which endpoints** they call, **which routes** they link to, and **which feature keys** gate their
buttons. Those three move into one object, chosen by the shell:

```ts
// lib/surface.ts (pure, continued)
export type Workspace = "ops" | "franchise";
export interface WorkspacePaths {
  technicians: string;                 // "/technicians"            | "/franchise/technicians"
  technician(id: string): string;
  technicianTickets(id: string): string;
  tickets: string;                     // "/tickets"                | "/franchise/tickets"
  ticket(id: string): string;
  redemptions: string;                 // "/redemptions"            | "/franchise/redemptions"
  redemption(id: string): string;
}
export const WORKSPACE_PATHS: Record<Workspace, WorkspacePaths>;
export interface WorkspaceFeatures {
  createTechnician: string; inviteTechnician: string; editTechnician: string;
  decideUpi: string; payRedemptions: string; viewPool: string;
  reversePoolPenalty: string | null;   // null on ops: staff reverse on the ticket page
}
export const WORKSPACE_FEATURES: Record<Workspace, WorkspaceFeatures>;
// ops:       technicians.create / .invite / .edit / .edit / redemptions.pay / earnings.view / null
// franchise: franchise.technicians ×3 / franchise.payouts / franchise.payouts / franchise.pool / franchise.pool
```

```ts
// services/workspace.ts (new) — plain objects of plain async functions; no React
export interface TechnicianSource {
  list; get; create; update; remove; sendAppLink;
  getUpiChange; approveUpiChange; rejectUpiChange;
  invite; resendInvite; cancelInvite;
}
export interface RedemptionSource { list; count; get; claim; decline; }
export interface LedgerSource { pool; entries; reverse: ((v: { entryId: string; reason: string }) => Promise<LedgerEntry>) | null; }
export interface WorkspaceApi {
  kind: Workspace; paths: WorkspacePaths; features: WorkspaceFeatures;
  technicians: TechnicianSource; redemptions: RedemptionSource; ledger: LedgerSource;
}
export const OPS_WORKSPACE: WorkspaceApi;        // built from the EXISTING functions in services/technicians.ts, redemptions.ts, ledger.ts
export const FRANCHISE_WORKSPACE: WorkspaceApi;  // built from services/franchise.ts
```

```ts
// hooks/useWorkspace.ts (new) — context + hook in a .ts file, so react-refresh's
// only-export-components rule has nothing to complain about
export const WorkspaceContext = createContext<WorkspaceApi>(OPS_WORKSPACE);
export const useWorkspace = () => useContext(WorkspaceContext);
```

`FranchiseShell` wraps its `<Outlet />` in `<WorkspaceContext.Provider value={FRANCHISE_WORKSPACE}>`.
**`AppShell` changes nothing** — the default value is the ops workspace, so every staff screen behaves
exactly as before. That is the property that makes this safe to land.

**Rejected alternatives.**
- *Route-aware services* (a service reading `location.pathname` or the session to pick its base URL):
  services are plain functions with no React; hidden coupling to the URL would make `listTechnicians`
  answer differently depending on where it was called from, which nothing in its signature says.
- *Forked portal pages*: seven pages and five components would exist twice, and the first fix to the
  staff copy (there is a long comment above nearly every line of `TechTable`) would miss the portal one.
- *A `portal` boolean prop threaded through each component*: that is `TicketDetailPage`'s `actions` slot
  and it worked for one page; for twelve components it is a prop drilled four levels to reach a `Link`.

**Query keys stay as they are.** The cache is cleared on every sign-in (`useLogin` → `queryClient.clear()`)
and a session belongs to exactly one surface, which `RequireAuth`/`RequireFranchise` enforce — so the
same key can never hold rows from both workspaces. **Decision (writer)**: adding the workspace to every
key factory would touch every invalidation for no case that can occur.

### 5.3 Services, types, hooks

| File | Change |
|---|---|
| `services/franchise.ts` (**new**) | Mirror `services/technicians.ts` / `redemptions.ts` / `ledger.ts`, against §4.2–4.4: `listFranchiseTechnicians`, `getFranchiseTechnician`, …, `getTechnicianOptions`, `listFranchisePincodes(params, { regionId })`, `listUpiChanges`, `upiChangesPendingCount`, `listFranchiseRedemptions`, …, `getFranchisePool`, `listFranchiseLedger`, `reverseFranchisePenalty`, `downloadStatement({ technicianId, month, filename })` (via `apiGetBlob` + `saveBlob`). The header comment repeats the redemptions rule: **no function here marks a redemption paid.** |
| `services/workspace.ts` (**new**) | §5.2. |
| `utils/download.ts` (**new**) | `saveBlob(blob, filename)` — the body of `downloadTicketTemplate`, promoted on its third consumer (ticket template, serial template, statements). Both existing callers switch to it. |
| `utils/slug.ts` (**new**) | `slug(text)` — the regex `LedgerTable` inlines for its CSV name; `LedgerTable` switches to it. |
| `types/franchise.ts` (**new**) | `MeFranchisee` (re-exported to `types/api.ts`), `TechnicianOptions`, `UpiChangeRow`, `StatementMonth { value: "YYYY-MM"; label: string; isCurrent: boolean }`. |
| `types/index.ts` | `LedgerEntry.kind` widens to `"penalty" \| "bonus" \| "reversal" \| "speed_reward" \| "speed_penalty" \| (string & {})` so an unknown kind still renders; `LedgerTable`'s `KIND_LABEL` lookup falls back to the raw kind with the neutral tone. Labels for the speed kinds are **Task 13**'s copy. |
| `hooks/useTechnicians.ts` | Every hook reads `const ws = useWorkspace()` and calls `ws.technicians.*` (`useTechnicians`, `useTechnician`, `useUpiChange`, every mutation, `useSendAppLink`). **Unchanged and ops-only:** `useCandidateTechnicians`, `useDistrictBreakdown` (they call `services/technicians.ts` directly — a franchise has no assignment screen and no territory panel). New: `useTechnicianOptions({ enabled })` (key `["technicians", "options"]`), `useInfiniteFranchisePincodes(search, regionId, enabled)` (key `["franchise", "pincodes", search, regionId]`), **`useCoverageOptions(query, regionId)`** (§5.4), **`useCertifiableSubcategories()`** (ops → `useCertifiableNodeOptions()`; franchise → options' subcategories mapped to `NodeOption` by the pure `toNodeOption`), **`useTechnicianFilterOptions()`** (ops → `useAssignableRegions()` + `useDistricts({ mine: true })`; franchise → options' regions and no districts). Each calls both underlying queries with `enabled` flags, never conditionally (rules of hooks). |
| `hooks/useCompanyUsers.ts` | `useRegions({ enabled = true } = {})` and `useAssignableRegions({ enabled })` — needed so the franchise side never fetches the territory regions (a 403 would toast on every form open). |
| `hooks/useGeo.ts` | none — `useDistricts` and `useInfinitePincodes` already take `enabled`. |
| `hooks/useRedemptions.ts` | `useRedemptions`, `useRedemption`, `useRedemptionsBadge`, `useClaimRedemption`, `useDeclineRedemption` read `useWorkspace().redemptions`. |
| `hooks/useLedger.ts` | `useLedgerPool`, `useLedgerEntries` read `useWorkspace().ledger`; new `useReversePoolPenalty()` (`ws.ledger.reverse`, invalidates `ledgerKeys.all`; `meta.errorTitle: "Couldn't reverse the penalty"`). |
| `hooks/useFranchise.ts` (**new**) | `franchiseKeys = { all: ["franchise"], upiChanges: (p) => ["franchise", "upi-changes", p], upiCount: () => ["franchise", "upi-changes", "count"] }`; `useUpiChanges(params)` (keepPreviousData, `staleTime: 10_000`, `refetchOnWindowFocus`), `useUpiChangesBadge({ enabled })` (`BACKSTOP_REFETCH_MS`, like `useRedemptionsBadge`), `useDownloadStatement()` (a `useMutation`; `meta.errorTitle: "Couldn't download the statement"`). The UPI mutations in `useTechnicians.ts` also invalidate `franchiseKeys.all`. |
| `hooks/useTicketStream.ts` | Invalidate `franchiseKeys.all` on `notification.raised` beside `redemptionKeys.all`. |

### 5.4 Components changed (shared with the staff side)

| File | Change |
|---|---|
| `components/technicians/CoverageFields.tsx` | Its two data sources move behind `useCoverageOptions(query, regionId)` → `{ regions, loadingRegions, search, boundedByStates, ownStates, scopeName }`. Markup unchanged. In the franchise workspace `boundedByStates` is false, `search` is `/franchise/pincodes`, and the hint names the franchisee (copy §5.9). Region still auto-fills when there is one (hard rule 10). |
| `components/technicians/TechnicianFormDialog.tsx` | `useCertifiableNodeOptions()` → `useCertifiableSubcategories()`. Nothing else. |
| `components/technicians/TechTable.tsx` | `` `/technicians/${id}` `` (link and row click) → `ws.paths.technician(id)`. The **Franchisee** column and filter (Task 08) render only when `ws.kind === "ops"` — in the portal every row is the same franchisee. **A *Base* column on both surfaces (owner ruling 2026-10-15, R9):** the source chip (*Pincode / GPS / Map / Set by admin*) from `baseSource` / `baseSetBySelf`, or *Not set* — so a self-set base is visible on the list; no coordinates (Task 13 §5.5 owns the component). |
| `pages/technicians/TechnicianListPage.tsx` | `has("technicians.create" \| "invite" \| "edit")` → `has(ws.features.*)`; regions/districts from `useTechnicianFilterOptions()`; Task 08's `useFranchiseeOptions` gated on `ws.kind === "ops" && has("franchisees.view")`. |
| `pages/technicians/TechnicianProfilePage.tsx` | Back fallback `ws.paths.technicians` / "Back to technicians"; `seeAllTo={ws.paths.technicianTickets(id)}`; `canEdit = has(ws.features.editTechnician) && tech.canManage`; `UpiChangePanel canDecide={has(ws.features.decideUpi) && tech.canManage}` — **on the portal the UPI decision is `franchise.payouts`, not the edit key** (index §3.4). **Profile also mounts Task 13's `BaseLocationPanel` (owner ruling 2026-10-15, R9): the source chip, *Set by {name} ({role})* and — for the franchisee admin and home managers who can manage the technician — the coordinates and a Change action; no approval flow. An Area Manager viewing a non-home technician sees the chip but not the coordinates.** |
| `pages/technicians/TechnicianJobsPage.tsx` | Back fallback `ws.paths.technician(id)`; `<TicketTable basePath={ws.paths.tickets} …>`. |
| `components/technicians/JobHistoryTable.tsx` | `` `/tickets/${id}` `` (link and row click) → `ws.paths.ticket(id)`. |
| `components/redemptions/RedemptionTable.tsx` | Row click → `ws.paths.redemption(id)`. |
| `pages/redemptions/RedemptionsPage.tsx` | none (hooks carry the workspace). |
| `pages/redemptions/RedemptionPage.tsx` | Back fallback `ws.paths.redemptions`; technician link → `ws.paths.technician(id)`. |
| `components/ledger/LedgerTable.tsx` | Technician and ticket links → `ws.paths.*`. New optional props `onReverse?: (e: LedgerEntry) => void` and `canReverse?: (e) => boolean`; when given, a trailing column renders **Reverse** on rows where `isReversible(e)`. CSV name via `ledgerFileName(brand.name, me?.franchisee?.name)`. |
| `pages/ledger/LedgerPage.tsx` | When `ws.features.reversePoolPenalty && has(it)`, hold a `reversing: LedgerEntry \| null` state, pass `onReverse`, and mount `tickets/ReversePenaltyDialog` with `penalty={toTicketPenalty(reversing)}` (pure adapter, §6). Header copy differs per workspace via `PageMeta`. |
| `components/notifications/routeFor.ts` (**extracted** from `NotificationList.tsx`, now exported) | `routeFor(to, surface)` with a third table `FRANCHISE_ROUTES`: `/tickets/` → `/franchise/tickets/…`, `/technicians` (the list — Task 05's `technician_moved` row) and `/technicians/…` → `/franchise/technicians…`, `/redemptions` → `/franchise/redemptions…`; fallback `/franchise`. `NotificationList` passes `surfaceOf(session)`. |
| `services/notifications.ts`, `components/notifications/kinds.ts` | New kind `technician_moved` (index §3.3 — the stored value; raised by Task 03, addressed to a franchisee's admins by Task 05) in the union, the ordered array and `KIND` (icon `ArrowLeftRight`, info tone) (reconciled). |
| `types/ticket.ts`, `components/tickets/FactGrid.tsx` | `TicketOut.vendorPricePaise` becomes `number \| null` (Task 04 nulls it for every franchise caller, index §6 — settled by the owner 2026-10-15, R6). `FactGrid`'s *Billed to vendor* row renders `—` for null; the staff-only `ForceClosePage` keeps passing it through (staff always receive a number) and the form renders `—` for null rather than `₹0` (reconciled). |

### 5.5 New components — `components/franchise/`

| File | Mirrors | What it does |
|---|---|---|
| `franchiseNav.ts` | `vendor/portalNav.ts` (read its header comment — every reason applies) | `FranchiseNavItem { label; to; icon; match?; feature: string /* REQUIRED */ }`; `FRANCHISE_NAV` in rail order (table below); `FRANCHISE_UNGATED = new Set(["/franchise", "/franchise/account", "/franchise/notifications", "/franchise/password"])`; `featureForFranchisePath(pathname)`; `activeFranchisePath(items, pathname)`; **`franchiseNav(has)`** = the table filtered by held features; **`franchiseLanding(has)`** = the first held entry's `to`, else `/franchise/account` (ungated, so the guard can never redirect into a loop). |
| `shared/navMatch.ts` (**extracted**) | `portalNav.ts`'s private `longestMatch` | Exported generic `longestMatch<T extends { to; match? }>(items, pathname)`. `portalNav.ts` imports it — no behaviour change. |
| `franchiseRouteMeta.ts` | `shared/routeMeta.ts` | Pure path → `{ title, subtitle }` for the shell's header `<h1>` (exactly one per page — adminWeb Accessibility). The reused staff pages render no heading of their own (they rely on `AppShell`'s topbar), so the shell must supply it; the vendor approach of an `<h2>` inside each page would mean editing the shared pages. |
| `FranchiseShell.tsx` | `vendor/VendorShell.tsx` (drawer, Escape, sticky bar, Sign out on the bar, no company switcher, no dead search box) | Adds the `<h1>` from `franchiseRouteMeta`, mounts `useTicketStream()` + `useNotificationToasts()`, and wraps the outlet in `WorkspaceContext.Provider value={FRANCHISE_WORKSPACE}`. Below `md` the bar shows company name + franchisee name. |
| `FranchiseSidebar.tsx` | `vendor/VendorSidebar.tsx` (same gradient, widths, active treatment, account footer → `/franchise/account`) | Header: **`BrandMark mark={brand.mark} label={brand.name}`** from `useBrand()` — the company's tile, not a store icon — then `brand.name` and, under it, `me.franchisee.name`. Items from `franchiseNav(has)`; badges: Redemptions ← `useRedemptionsBadge({ enabled: has("franchise.payouts") })` (inside the provider, so it counts `/franchise/redemptions/count`), UPI changes ← `useUpiChangesBadge(...)`. A zero badge is not drawn. Does **not** reuse `shared/Sidebar` (it reads `NAV_GROUPS`; one `has(undefined)` from showing staff screens). |
| `UpiChangeTable.tsx` | `redemptions/RedemptionTable.tsx` | `DataTable` server mode. Columns *Technician* (name + code), *Current UPI ID*, *Asked for* (new UPI ID + name), *Requested* (`relativeTime`), *Status*. Status filter (static select: Pending, Approved, Rejected, All). Row click → `ws.paths.technician(technicianId)` with `useNavOrigin("Back to UPI changes")`; the decision happens in `UpiChangePanel` there. |
| `StatementMonthPicker.tsx` | toolbar select (`w-40`) | Options from `statementMonths(now, 12)`; value in `?month=` (a view is a link). |
| `EmployeeStatementTable.tsx` | `technicians/TechTable.tsx` columns, trimmed | *Employee* (avatar, name, code), *Mobile*, *Status*, action *Download CSV* (spinner while that row's download runs). Toolbar holds the month picker. Loading / empty / error states. |
| `statements.ts` (**pure**) | — | `statementMonths(now: Date, count = 12): StatementMonth[]` — IST calendar months, newest first, current month flagged; `defaultStatementMonth(now)` = the **previous** IST month (payroll is run after a month closes); `statementFileName({ company, franchisee, code, month })` → `acme-appliances-skyfix-services-tch-4021-2026-09.csv`; `isStatementMonth(value)` validates `?month=`. |
| `ledgerAdapters.ts` (**pure**) | — | `REVERSIBLE_KINDS = ["penalty", "speed_penalty"]`; `isReversible(e)`; `toTicketPenalty(e: LedgerEntry): TicketPenalty` for `ReversePenaltyDialog`; `ledgerFileName(company, franchisee?)`. |

`FRANCHISE_NAV` (order = rail order = landing preference):

| Label | `to` | `match` | `feature` | Icon |
|---|---|---|---|---|
| Technicians | `/franchise/technicians` | `/franchise/technicians/` | `franchise.technicians` | `Users` |
| UPI changes | `/franchise/upi-changes` | — | `franchise.payouts` | `ArrowLeftRight` |
| Redemptions | `/franchise/redemptions` | `/franchise/redemptions/` | `franchise.payouts` | `IndianRupee` |
| Penalty & bonus pool | `/franchise/pool` | — | `franchise.pool` | `Coins` |
| Employee statements | `/franchise/statements` | — | `franchise.statements` | `FileSpreadsheet` |
| Tickets | `/franchise/tickets` | `/franchise/tickets/` | `franchise.tickets` | `ListFilter` |

**Landing per role** falls out of that order and the role defaults (index §3.4): a **franchisee admin**
holds `franchise.technicians` → `/franchise/technicians`; a **facility admin / operator** holds only
`franchise.tickets` (+ `franchise.facility_users` / `parts.handle`, which have no entry yet) →
`/franchise/tickets`. Task 13 inserts its parts queue **above Tickets** and facility users at the end;
facility roles then land on the parts queue with no change to `franchiseLanding`.

**Decision (writer): no Facility users entry in this task.** A facility user has nothing to do until
spare parts exist (Task 12), and an entry whose only possible state is empty is not shipped (root
AGENTS, the AI-review reasoning). Task 13 adds `/franchise/facility-users` (`franchise.facility_users`)
to `FRANCHISE_NAV`, `franchiseRouteMeta.ts` and `routes.tsx`, in that one commit.

### 5.6 Pages — `pages/franchise/` (new) and the route tree

| File | Mirrors | Notes |
|---|---|---|
| `FranchiseLanding.tsx` | `RedirectToTicket` in `routes.tsx` | `useFeatureAccess()`; `loading` → `PageSkeleton`; else `<Navigate to={franchiseLanding(has)} replace />`. |
| `FranchiseUpiChangesPage.tsx` | `pages/redemptions/RedemptionsPage.tsx` | `useUrlSeededListParams({ filters: { state: "pending" } }, ["state"])` — starts explicitly on Pending, the way Redemptions starts on To pay. |
| `FranchiseStatementsPage.tsx` | `pages/vendor/VendorUsersPage.tsx` | Month from `?month=` (invalid → `defaultStatementMonth`), employees from `useTechnicians({ filters: { view: "registered", technicianType: "employee" } })` (inside the provider → `/franchise/technicians`), download through `useDownloadStatement()`, file named by `statementFileName` with `useBrand().name` and `me.franchisee.name`. |
| `FranchiseTicketsPage.tsx` | `pages/vendor/VendorTicketsPage.tsx` | `TicketTable basePath="/franchise/tickets"`; empty copy of its own. Not the staff `TicketListPage`, which carries the import dialog and `NarrowedNotice` for dashboard links that do not exist here. |

```tsx
// routes.tsx — a new top-level branch, beside the vendor portal's
{
  element: <RequireFranchise />,
  children: [{
    element: <FranchiseShell />,
    children: [
      { path: "franchise", element: <FranchiseLanding /> },          // outside the feature guard: it only redirects
      { element: <RequireFranchiseFeature />, children: [
        { path: "franchise/technicians", element: <TechnicianListPage /> },
        { path: "franchise/technicians/:id", element: <TechnicianProfilePage /> },
        { path: "franchise/technicians/:id/tickets", element: <TechnicianJobsPage /> },
        { path: "franchise/upi-changes", element: <FranchiseUpiChangesPage /> },
        { path: "franchise/redemptions", element: <RedemptionsPage /> },
        { path: "franchise/redemptions/:id", element: <RedemptionPage /> },
        { path: "franchise/pool", element: <LedgerPage /> },
        { path: "franchise/statements", element: <FranchiseStatementsPage /> },
        { path: "franchise/tickets", element: <FranchiseTicketsPage /> },
        { path: "franchise/tickets/:id",
          element: <TicketDetailPage backTo="/franchise/tickets" backLabel="Back to tickets" actions={null} /> },
        { path: "franchise/notifications", element: <NotificationsPage /> },
        { path: "franchise/account", element: <AccountPage /> },
        { path: "franchise/password", element: <ChangePasswordPage /> },
      ]},
    ],
  }],
},
```

`TicketDetailPage` with `actions={null}` sets `isOps = false`, which already hides force-close,
reschedule, no-show, penalty reversal, reading correction, the attachments panel, and skips the
`settings/rules` read — the portal inherits the vendor's read-only page with no edit to it.

**What the read-only portal ticket shows (owner ruling 2026-10-15, R8 / R6).** The franchisee admin sees the
**Travel** and **Speed** panels (Task 13 §5.8) for its own franchisee's tickets, because the server sends both blocks
to it and nulls them for facility staff and vendors; the *Billed to vendor* figure is `—` for every franchise
principal (R6, settled). The **staff** console shows the same two panels to an Area Manager and above on **every**
ticket in scope, a non-home franchisee's included (§5.10) — so the two panels never differ by the ticket's franchisee.

`/franchise/technicians/:id/tickets` lists through `GET /tickets?technicianId=`, so a franchisee admin
without `franchise.tickets` (a company override) gets the server's empty/403 there; the guard reads the
`Technicians` entry's `match` and lets them in. Accepted: the override is the company's own choice.

### 5.7 Brand (white label)

- Rail tile and first line: `useBrand()` — the **company**. Second line: `me.franchisee.name`.
- `PageMeta` already prefixes the tab with `useBrand().name`; nothing to change.
- The statement and ledger file names start with the company slug, then the franchisee slug.
- An external franchisee's own name appears only as the second line and in file names — it never
  replaces the company's tile (F1/F11: it leases the company's name).

### 5.8 Notifications in the portal

The bell (`NotificationBell`) links to `SHELL_PATHS.franchise.notifications`. A row's stored route is
staff-style and `routeFor(to, "franchise")` rewrites it (§5.4). The kinds a franchisee admin receives
after Task 05: `upi_change` → their technician's profile; `redemption` → the redemption;
`technician_moved` → the technicians list (its `to` is `/technicians`). An unknown kind still lands on `/franchise`.

### 5.9 PROPOSED copy (needs owner sign-off — index X2, §7)

No prototype covers the portal. Strings reused unchanged from the staff screens (the technician list,
form, invite, UPI panel, redemption queue and page, pool summary, ledger table, ticket detail) are
**already approved** and are not repeated. Every string below is net-new. `{company}` = `useBrand().name`,
`{franchisee}` = `me.franchisee.name`.

| Where | String |
|---|---|
| Rail entries | Technicians · UPI changes · Redemptions · Penalty & bonus pool · Employee statements · Tickets |
| Rail aria-label | Franchise portal |
| Mobile bar sub-line | {company} |
| Header (franchiseRouteMeta) | Technicians · {franchisee}'s technicians |
| | Technician profile · Category · pincode · bandwidth *(reused)* |
| | Technician's tickets · Every job they have held |
| | UPI changes · Technicians asking to be paid somewhere new |
| | Redemptions · Technician payouts by UPI *(reused)* |
| | Redemption · Pay by UPI · record the proof *(reused)* |
| | Penalty & bonus pool · {franchisee}'s pool |
| | Employee statements · A month's allowances and penalties, per employee |
| | Tickets · Tickets in {franchisee}'s pincodes — read only |
| | Ticket detail · Timeline & audit trail *(reused)* |
| | Notifications · Recent events for {franchisee} |
| | Account · Your profile & session *(reused)* |
| Coverage hint (portal) | Pincodes {franchisee} runs, in {region}. Search by code or district. |
| Coverage empty search | No pincode {franchisee} runs matches that |
| UPI changes table caption | Technicians asking to change the UPI ID they are paid on |
| UPI changes columns | Technician · Current UPI ID · Asked for · Requested · Status |
| UPI changes status | Pending · Approved · Rejected · All |
| UPI changes empty | No UPI changes waiting · When a technician asks to be paid on a new UPI ID, it appears here. |
| UPI changes filtered empty | No changes match that status · Try a different status. |
| UPI changes error | Couldn't load UPI changes |
| Back (from profile) | Back to UPI changes |
| Pool: Reverse action | Reverse |
| Pool: reverse toast | Penalty reversed · {amount} goes back to {technician}. |
| Pool: reverse error title | Couldn't reverse the penalty |
| Statements month label / option suffix | Month · (so far) |
| Statements caption | Employees and their monthly statement |
| Statements columns | Employee · Mobile · Status · Download CSV |
| Statements note | Each statement lists the month's travel, speed rewards, penalties and bonuses for one employee, to add to their salary. Salary itself is not recorded here. |
| Statements empty | No employees yet · Technicians whose Type is Employee appear here. Change a technician's Type on their profile. |
| Statements error | Couldn't load employees |
| Statements download error title | Couldn't download the statement |
| Statements download toast | Statement downloaded · {name}, {month} |
| Tickets empty | No tickets yet · Tickets for {franchisee}'s pincodes appear here once a vendor raises them. |
| Tickets empty (facility roles) | No tickets need you yet · Tickets with a spare-part request appear here. |
| 404 back button (franchise) | Back to the portal |
| Notification kind label | Technician moved |

---

### 5.10 Staff-console changes from Tasks 05/06 (added by the index owner)

Tasks 05 and 06 change APIs that the **staff** console already calls. Task 08 owns the technician
list/form changes: Franchisee and Type columns, filters, the Type field, and `canManage`. Ship the
remaining changes below with this task, as a separate commit `feat(console): staff screens learn
franchisees`.

| Screen / file | Change | API (from) |
|---|---|---|
| `pages/settings/BonusSetupPage.tsx` (escalation bonus) | Pass the ticket's `franchiseeId` to `GET /ledger/pool`, so the "pool can afford it" figure is the franchisee's pool (F12) | Task 05 §4 pool |
| `pages/ledger/LedgerPage.tsx` (Penalty & Bonus) | Admin/NH get a **Franchisee** selector (default: home) driving `?franchiseeId=`. Actions are read-only when the row's `canAct` is false. | Task 05 |
| `pages/redemptions/RedemptionsPage.tsx` | Same Franchisee selector. Claim/Decline only when `canAct` (a non-home franchisee's redemptions are paid by its own admin, F8). | Task 05 |
| Ticket detail, penalty row | Show *Reverse* only when the server sends `canReverse` | Task 05 `core/penalty_reversal.py` |
| Force-close dialog | When `ticket.technicianType === "employee"`, hide the payout box and show the PROPOSED line below | Task 06 §5 |
| Ticket detail — Travel and Speed panels | **Owner ruling 2026-10-15 (R8):** shown to Area Manager and above on every ticket in scope, **non-home included** (it used to hide the speed block from an AM on a non-home ticket); facility staff and vendors get neither. Panels are Task 13's; this row only records that the staff ticket page must not gate them on the franchisee. | Tasks 10, 11, 13 |
| Technician profile (home franchisee, employee) | *Download statement* action, month picker defaulting to the previous IST month, calling `GET /ledger/statements/{technicianId}?month=YYYY-MM`. Reuse the portal's `StatementDownload` component through the workspace adapter (§5.2). | Task 06 |

PROPOSED copy (add to §5.9's sign-off list):
- "Franchisee"
- "Managed by {franchisee}"
- "Employees are paid through salary — no per-job payout."
- "Download statement"

Acceptance for these changes:
1. An NH switching the Penalty & Bonus selector to a non-home franchisee sees that franchisee's pool and has no reverse/claim actions where `canAct` is false.
2. Force-closing an employee's job shows no payout box.
3. A home employee's statement downloads as CSV for the chosen month.
4. (owner ruling 2026-10-15, R8) An Area Manager opening a SkyFix (non-home) ticket sees both the Travel and the Speed panel; the same ticket as a facility operator shows neither; the franchise admin's read-only page shows both and `—` for *Billed to vendor*.
5. (owner ruling 2026-10-15, R9) The technician list and profile, on both surfaces, show the base's source chip; a technician-set GPS base reads *GPS* / *Set by the technician*; after the franchisee admin corrects it, *Map* / *Set by {admin}*; nothing asks for approval.

## 6. Unit tests (vitest — `src/**/*.test.{ts,tsx}`, jsdom, Task 00 harness)

| File | Cases |
|---|---|
| `src/lib/surface.test.ts` | `surfaceOf`: superadmin wins over `franchise: true` and `portal: true`; franchise over portal; none → ops. `SHELL_PATHS` homes are `/companies`, `/franchise`, `/portal`, `/`. `WORKSPACE_PATHS.franchise.technician("a")` = `/franchise/technicians/a`; `.ticket("t")` = `/franchise/tickets/t`; ops twins unprefixed. `WORKSPACE_FEATURES.franchise.decideUpi` = `franchise.payouts`; `ops.reversePoolPenalty` = null. |
| `src/store/session.test.ts` | `landingPath` ordering (all eight combinations of the three flags). Persist `migrate` from v6: a stored `backendUser.role = "franchisee_admin"` yields `franchise: true` and keeps `signedIn`; `"admin"` yields `franchise: false`; from v5 → reset. `signInBackend` with each franchise role sets `franchise` and leaves `portal` false. |
| `src/components/franchise/franchiseNav.test.ts` | `featureForFranchisePath`: `/franchise/technicians/x/tickets` → `franchise.technicians`; `/franchise/redemptions/r` → `franchise.payouts`; `/franchise/unknown` → undefined; `/franchisees` → undefined. `franchiseNav(has)` with only `franchise.tickets` → `[Tickets]`. `franchiseLanding`: franchisee-admin feature set → `/franchise/technicians`; facility set (`franchise.tickets`, `parts.handle`, `franchise.facility_users`) → `/franchise/tickets`; empty set → `/franchise/account`, which is in `FRANCHISE_UNGATED` (no-loop property). Every `FRANCHISE_NAV` item has a non-empty `feature`. |
| `src/components/shared/navMatch.test.ts` | Longest prefix beats shorter (`/portal/tickets/new` vs `/portal/tickets`); exact beats prefix; `match` entries honoured; no match → undefined. Plus one `portalNav` regression: `featureForPortalPath("/portal/credit/payments/1")` still `vendor.credit`. |
| `src/components/franchise/statements.test.ts` | `statementMonths(new Date("2026-09-30T19:00:00Z"))` starts at **October 2026** (01:30 IST on 1 Oct) flagged current; `(…"2026-09-30T18:00:00Z")` starts at September; 12 entries, newest first, values `YYYY-MM`; year rollover Jan → previous December. `defaultStatementMonth` = previous IST month. `statementFileName` slugs company and franchisee, lower-cases the code, ends `-2026-09.csv`, never contains spaces or `/`. `isStatementMonth("2026-13")` false, `("2026-09")` true. |
| `src/components/franchise/ledgerAdapters.test.ts` | `isReversible`: penalty not reversed → true; reversed → false; bonus/reversal/travel → false; `speed_penalty` → true. `toTicketPenalty` copies id, amountPaise, reason, technicianName, `chargedAt = at`, reversal fields null. `ledgerFileName("Acme Appliances", "SkyFix Services")` → `acme-appliances-skyfix-services-ledger.csv`; without a franchisee → today's `acme-appliances-ledger.csv` (regression). |
| `src/components/notifications/routeFor.test.ts` | Franchise: `/tickets/1?focus=x` → `/franchise/tickets/1?focus=x`; `/technicians/2` → `/franchise/technicians/2`; `/technicians` → `/franchise/technicians`; `/redemptions/3` → `/franchise/redemptions/3`; `/approvals` → `/franchise`. Vendor and ops tables unchanged (existing cases pinned). |
| `src/hooks/useWorkspace.test.tsx` | Rendered without a provider → `kind === "ops"` and `technicians.list === listTechnicians`; inside `WorkspaceContext.Provider value={FRANCHISE_WORKSPACE}` → `kind === "franchise"`. |
| `src/components/technicians/TechTable.test.tsx` (extends Task 08's) | Inside the franchise provider: the name link's `href` is `/franchise/technicians/<id>` and the Franchisee column is absent. |

---

## 7. Acceptance criteria

Against dev (`RelianceDB`), local API on :8000, in **GreenTech Demo Services**. Create the test
franchisee and its admin through Task 08's screen; never touch *Testing Company*.

1. **Given** a franchisee admin of franchisee A, **when** they sign in, **then** they land on
   `/franchise/technicians`; the rail shows the company's tile and name with A's name beneath; the tab
   title starts with the company's name; the rail lists exactly the six entries their features allow.
2. **Given** that session, **when** they type `/`, `/technicians`, `/technicians/<id>`, `/escalations`,
   `/franchisees`, `/portal/tickets` or `/companies`, **then** each redirects to `/franchise` (and on to
   their landing) without rendering a staff or vendor screen.
3. **Given** a technician id belonging to franchisee B of the same company, **when** A's admin opens
   `/franchise/technicians/<B's id>`, **then** the page shows **Couldn't load this technician** (API
   404) and no B data appears in any request's response (Network tab).
4. **Given** A's admin adds a technician, **then** Region fills itself when A's pincodes sit in one
   region, the pincode search offers only A's pincodes, Type defaults to Freelancer, and the new row
   appears in A's list and in the staff list under franchisee A.
5. **Given** a pending UPI change for A's technician, **then** the UPI changes badge shows 1, the row
   opens the profile, **Approve change** applies it, and the badge clears.
6. **Given** a redemption request from A's freelancer, **then** Redemptions shows it under *To pay*, the
   page draws the QR, **Mark as paid** records the claim, and there is no way to mark it confirmed.
7. **Given** A's pool, **then** the summary and ledger show only A's entries; **Reverse** on a standing
   penalty opens the reason dialog and, on save, a *Penalty reversed* row appears and the balance moves;
   a second reverse on the same entry shows the 409 toast.
8. **Given** an employee in A and the month picker on the previous month, **when** *Download CSV* is
   pressed, **then** a file named `<company>-<franchisee>-<code>-<YYYY-MM>.csv` downloads and opens in
   Excel with ₹ intact.
9. **Given** A's tickets, **then** the list shows only tickets stamped A, the detail shows the timeline
   and proof, and there is no Assign, Reschedule, No-show, Force close, Reverse or attachments panel.
10. **Given** a facility operator of A, **then** they land on `/franchise/tickets`, the rail shows only
    Tickets, and `/franchise/technicians` redirects them back to `/franchise/tickets`.
11. **Given** a staff Admin, **then** every staff screen behaves exactly as before (spot-check
    Technicians, a profile's UPI panel, Redemptions, Penalty & Bonus, a ticket page) — the default
    workspace is ops.
12. **Given** a vendor, **then** the vendor portal is unchanged and `/franchise/technicians` redirects
    them to `/portal`.
13. **Given** a session persisted before this deploy, **then** nobody is signed out by the version bump.
14. **Given** any portal list (technicians, UPI changes, redemptions, pool, statements, tickets),
    **then** it shows a skeleton while loading, an empty state with no rows, and `ErrorState` + one
    toast with the API stopped.
15. `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` green in `adminWeb/`; `vite build`
    emits the portal pages as their own lazy chunks and `FranchiseShell` is not in the staff entry chunk.
16. **Playwright smoke** (webapp-testing skill; `python scripts/with_server.py --server "npm run dev"
    --port 5173 -- python d:/tmp/franchise_portal_smoke.py`; `p.chromium.launch(channel="msedge",
    headless=True)`; script, screenshots and `TEMP` on `D:\tmp\`):
    ```text
    1  login as franchisee admin of QA Franchise A → expect URL /franchise/technicians
    2  expect rail header text == company name, and second line == "QA Franchise A"
    3  assert rail link names == the six entries; assert no "Dashboard", "Escalation Queue"
    4  goto /technicians → expect URL to end with /franchise/technicians
    5  goto /franchise/technicians/<technician id of franchisee B, fetched by SQL beforehand>
       → expect text "Couldn't load this technician"
    6  click "Invite technician" → open pincode box, type "5000" → every option starts with A's codes
       → close without saving
    7  click "Employee statements" → expect month select and table (or empty state)
    8  click "Tickets" → open first row if any → assert no button named "Force close" / "Change the time"
    9  sign out → login as staff Admin → expect URL "/" and the staff rail → open /technicians
       → expect "Franchisee" column (ops workspace intact)
    10 screenshot each step to d:/tmp/f09-<n>.png
    ```

---

## 8. Out of scope and traps

1. **`landingPath` ordering.** Superadmin is asked first (no company, so no portal of any kind), then
   franchise, then vendor, then staff. The flags are mutually exclusive in practice, but the order is
   what `surfaceOf` and its test pin — never reorder by call site. All five consumers go through
   `landingPath`; a sixth that reads `backendUser.role` directly is how the shells stop agreeing.
2. **The franchise guard denies by default.** `useFeatureAccess().has(undefined)` is **true**. A route
   added under `RequireFranchiseFeature` without a `FRANCHISE_NAV` entry (or a `match` that covers it)
   is silently unreachable — and an entry with an optional feature would be visible to everyone. Keep
   `feature` required in the type.
3. **Do not nest the portal under `AppShell`.** It is a top-level branch for the same security reason
   as the vendor portal (adminWeb hard rule 0a): six staff paths are ungated.
4. **`/franchise` vs `/franchisees`.** The staff screen (Task 08) is plural. `featureForPath` and
   `featureForFranchisePath` both append `/` before prefix-matching; keep it that way.
5. **Tailwind v4 in adminWeb.** `@theme` tokens in `styles/theme.css`, static class strings, no hex, no
   inline style. The rail reuses the vendor rail's classes verbatim — do not invent a new gradient.
6. **Never write a product name.** Tile, rail, tab title and file names come from `useBrand()` and the
   franchisee name. `BRAND_NAME` is wrong here — the company is known.
7. **No confirm on redemptions, in either workspace.** `services/franchise.ts` must not grow one.
8. **`useWorkspace` outside the provider is ops.** A component rendered by the staff shell that reads the
   workspace gets ops — that is the safety property. A *new* portal-only page must sit under
   `FranchiseShell` or it will silently call staff endpoints.
9. **Hooks may not branch on the workspace.** Call both underlying queries with `enabled` flags
   (`useCoverageOptions`, `useTechnicianFilterOptions`); a conditional hook call compiles and breaks at
   runtime the first time a component re-renders under the other branch in a test.
10. **No 403 toasts on open.** Every staff-only query a shared component used to fire unconditionally
    (`useRegions`, `useDistricts`, `useNodeTree` via the form, `useFranchiseeOptions`) is gated with
    `enabled` in the franchise workspace — hard rule 9 toasts every failure, so an ungated one greets
    every franchisee admin with "Not allowed".
11. **Company switching.** The franchise shell has no `CompanySwitcher`; a person who is a franchisee
    admin in one company and staff in another keeps today's limitation (the `portal`/`franchise` flags
    are set at sign-in). Out of scope.
12. **Out of scope:** travel and speed settings (`franchise.settings`) and the base-location map pin
    (Task 13), facility users and the parts queue (Task 13), money between an external franchisee and
    the company (F11), a franchise dashboard, global search in the portal.
